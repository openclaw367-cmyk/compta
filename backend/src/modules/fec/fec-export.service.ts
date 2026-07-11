import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Account, Ecriture, EcritureLigne, Journal } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import {
  FEC_COLUMNS,
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

/**
 * Produces the FEC (Fichier des Écritures Comptables) export required by
 * Article A47 A-1 du LPF. Any change to the output shape here is
 * compliance-breaking — see CLAUDE.md "FEC export".
 */
@Injectable()
export class FecExportService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(company: CompanyContext, fiscalYearId: string): Promise<FecFile> {
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
      orderBy: { ecritureNum: 'asc' },
    })) as EcritureWithRelations[];

    const rows = ecritures.flatMap((ecriture) =>
      ecriture.lignes.map((ligne) => this.formatRow(ecriture, ligne)),
    );

    const content = [FEC_COLUMNS.join(FEC_DELIMITER), ...rows].join(FEC_LINE_BREAK);

    return { fileName: fecFileName(identifier, fiscalYear.endDate), content };
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
      String(ecriture.ecritureNum),
      formatFecDate(ecriture.ecritureDate),
      ligne.compte.number,
      ligne.compte.label,
      ligne.compteAux?.number ?? '',
      ligne.compteAux?.label ?? '',
      ecriture.pieceRef ?? '',
      ecriture.pieceDate ? formatFecDate(ecriture.pieceDate) : '',
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
