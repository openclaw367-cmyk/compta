import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Account, Company, Ecriture, EcritureLigne, FiscalYear, Journal } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import {
  FEC_COLUMNS,
  FEC_CONVENTIONAL_PIECE_REF,
  FEC_DELIMITER,
  FEC_LINE_BREAK,
  fecFileName,
  formatFecAmount,
  formatFecDate,
} from './fec-format';

type EcritureWithRelations = Ecriture & {
  journal: Journal;
  lignes: (EcritureLigne & { compte: Account; compteAux: Account | null })[];
};

export interface FecFile {
  fileName: string;
  content: string;
}

export interface FecDescription {
  fileName: string;
  content: string;
}

interface ExportContext {
  companyRecord: Company;
  fiscalYear: FiscalYear;
  identifier: string;
}

/**
 * Produces the FEC (Fichier des Écritures Comptables) export required by
 * Article A47 A-1 du LPF. Any change to the output shape here is
 * compliance-breaking — see CLAUDE.md "FEC export".
 */
@Injectable()
export class FecExportService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(company: CompanyContext, fiscalYearId: string): Promise<FecFile> {
    const { identifier, fiscalYear } = await this.resolveExportContext(company, fiscalYearId);

    const draftCount = await this.prisma.ecriture.count({
      where: { companyId: company.companyId, fiscalYearId, validatedAt: null },
    });
    if (draftCount > 0) {
      throw new ConflictException(
        `${draftCount} écriture(s) in this fiscal year are not yet validated. Validate or ` +
          'delete them before exporting — a FEC export never silently skips unvalidated entries.',
      );
    }

    const ecritures = (await this.prisma.ecriture.findMany({
      where: { companyId: company.companyId, fiscalYearId, validatedAt: { not: null } },
      include: {
        journal: true,
        lignes: { include: { compte: true, compteAux: true } },
      },
      // ecritureNum is a String (see schema) so sorting by it lexically
      // would put "10" before "2". Numbers are assigned in strictly
      // increasing order at validation time, so ordering by validatedAt
      // reproduces the correct ascending EcritureNum order without
      // parsing the string.
      orderBy: { validatedAt: 'asc' },
    })) as EcritureWithRelations[];

    const rows = ecritures.flatMap((ecriture) =>
      ecriture.lignes.map((ligne) => this.formatRow(ecriture, ligne)),
    );

    const content = [FEC_COLUMNS.join(FEC_DELIMITER), ...rows].join(FEC_LINE_BREAK);

    return { fileName: fecFileName(identifier, fiscalYear.endDate), content };
  }

  /**
   * The descriptif required by Article A47 A-1 du LPF §XI (referenced at
   * §VI-390 of the BOI commentary): whenever the file relies on
   * company-defined conventions rather than raw source data, that
   * convention must be documented and handed to the vérificateur
   * alongside the FEC file itself.
   */
  async generateDescription(
    company: CompanyContext,
    fiscalYearId: string,
  ): Promise<FecDescription> {
    const { identifier, fiscalYear } = await this.resolveExportContext(company, fiscalYearId);
    const fecName = fecFileName(identifier, fiscalYear.endDate);

    const content = [
      `Descriptif accompagnant le fichier des écritures comptables ${fecName}`,
      `(Article A47 A-1 du LPF §XI)`,
      '',
      `Séparateur de champs : "${FEC_DELIMITER}" (pipe)`,
      `Fin de ligne : CRLF`,
      `Format des dates (EcritureDate, PieceDate, DateLet, ValidDate) : AAAAMMJJ`,
      `Séparateur décimal (Debit, Credit, Montantdevise) : virgule "," (Art. A47 A-1 §XII)`,
      '',
      "Valeurs conventionnelles utilisées lorsqu'aucune donnée source n'est disponible :",
      `- PieceRef : "${FEC_CONVENTIONAL_PIECE_REF}" lorsque l'écriture n'a pas de pièce ` +
        "justificative associée (par exemple les écritures d'à nouveau).",
      "- PieceDate : date de l'écriture (EcritureDate) lorsqu'aucune date de pièce " +
        "justificative n'est disponible.",
    ].join(FEC_LINE_BREAK);

    return { fileName: `${fecName.replace(/\.txt$/, '')}_description.txt`, content };
  }

  private async resolveExportContext(
    company: CompanyContext,
    fiscalYearId: string,
  ): Promise<ExportContext> {
    const [companyRecord, fiscalYear] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: company.companyId } }),
      this.prisma.fiscalYear.findFirst({
        where: { id: fiscalYearId, companyId: company.companyId },
      }),
    ]);
    if (!companyRecord) {
      throw new NotFoundException(`Company ${company.companyId} not found`);
    }
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
    }

    const identifier =
      companyRecord.jurisdiction === 'FR' ? companyRecord.siren : companyRecord.rci;
    if (!identifier) {
      const field = companyRecord.jurisdiction === 'FR' ? 'SIREN' : 'RCI';
      throw new BadRequestException(
        `Company is missing its ${field}; a FEC export cannot be produced without it.`,
      );
    }

    return { companyRecord, fiscalYear, identifier };
  }

  private formatRow(
    ecriture: EcritureWithRelations,
    ligne: EcritureWithRelations['lignes'][number],
  ): string {
    if (ecriture.ecritureNum === null || !ecriture.validatedAt) {
      // Guarded by the `validatedAt: { not: null }` query filter above;
      // this is a defensive invariant check, not expected user input.
      throw new ConflictException(`Écriture ${ecriture.id} is missing its EcritureNum/ValidDate.`);
    }

    const fields: string[] = [
      ecriture.journal.code,
      ecriture.journal.label,
      ecriture.ecritureNum,
      formatFecDate(ecriture.ecritureDate),
      ligne.compte.number,
      ligne.compte.label,
      ligne.compteAux?.number ?? '',
      ligne.compteAux?.label ?? '',
      // PieceRef/PieceDate must never be blank (Art. A47 A-1 du LPF
      // §180/§190) — fall back to the documented conventional values
      // rather than the "blank if unused" rule that applies elsewhere.
      ecriture.pieceRef ?? FEC_CONVENTIONAL_PIECE_REF,
      formatFecDate(ecriture.pieceDate ?? ecriture.ecritureDate),
      ecriture.libelle,
      formatFecAmount(ligne.debit),
      formatFecAmount(ligne.credit),
      ligne.lettrage ?? '',
      ligne.dateLettrage ? formatFecDate(ligne.dateLettrage) : '',
      formatFecDate(ecriture.validatedAt),
      ligne.montantDevise ? formatFecAmount(ligne.montantDevise) : '',
      ligne.idDevise ?? '',
    ];

    return fields.join(FEC_DELIMITER);
  }
}
