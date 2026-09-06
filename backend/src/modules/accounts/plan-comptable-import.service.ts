import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { resolvePcgClass } from '../../common/pcg/resolve-pcg-class';
import { cellValueToString } from '../import-excel/import-excel.service';
import { isAuxiliaryBearingCollectif } from './accounts.service';
import {
  PlanComptableImportPreviewResponseDto,
  PlanComptableImportResultDto,
  PlanComptableImportRowDto,
} from './dto/plan-comptable-import-preview-response.dto';

export interface ImportedPlanComptableFile {
  originalname: string;
  buffer: Buffer;
}

/**
 * Own template, not a regulatory format (unlike FEC import) — CompteNum/
 * CompteLib match this app's existing Account.number/label naming (see
 * Account's own schema doc comment: "CompteNum/CompteLib in FEC terms"),
 * so a user familiar with either screen recognizes the columns.
 * CompteParentNum is this app's own invention: when present, the row is a
 * tiers (compte auxiliaire) under that collectif rather than a plain PCG
 * account — see "Plan Comptable" in CLAUDE.md. The six identity columns
 * are optional and meaningful only for a tiers row, mirroring
 * CreateTiersDto's own optional fields exactly.
 */
const REQUIRED_COLUMNS = ['CompteNum', 'CompteLib'] as const;

/** Preview response caps the displayed row list; confirm() never does. */
const PREVIEW_SAMPLE_SIZE = 500;

interface ParsedRow {
  rowNumber: number;
  number: string;
  label: string;
  parentNumber: string | null;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  sirenOrRci?: string;
  vatNumber?: string;
}

interface PlannedRow extends ParsedRow {
  pcgClass: number;
  isAuxiliary: boolean;
  action: 'CREATE' | 'UPDATE';
  /** Only set for a tiers row whose parent already exists in the DB (not created by this same file) — used as the pass-2 fallback at confirm time. */
  resolvedParentId?: string;
}

function toRowDto(row: PlannedRow): PlanComptableImportRowDto {
  return {
    rowNumber: row.rowNumber,
    number: row.number,
    label: row.label,
    pcgClass: row.pcgClass,
    isAuxiliary: row.isAuxiliary,
    parentNumber: row.parentNumber,
    action: row.action,
  };
}

/**
 * Bulk create-or-update for the chart of accounts from an Excel sheet —
 * "Plan Comptable" (see CLAUDE.md). Preview-then-confirm, same shape as
 * import-excel/fec-import: preview() parses and plans without persisting;
 * confirm() re-parses the resubmitted file (never trusts a cached
 * preview) and persists atomically, all-or-nothing.
 *
 * Deliberately additive/upsert-only — an account absent from the file is
 * never touched, let alone deleted (deletion is the separate, explicit,
 * per-account AccountsService.remove() action, gated on zero references).
 * Matching an existing account is by CompteNum only: an UPDATE never
 * changes isAuxiliary/parentId/pcgClass for an already-existing row (only
 * label + identity fields) — reparenting/renumbering an existing account
 * via a bulk file would be a surprising, hard-to-review side effect;
 * that stays the individual edit screen's job (AccountsService.rename()).
 */
@Injectable()
export class PlanComptableImportService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(
    company: CompanyContext,
    file: ImportedPlanComptableFile,
  ): Promise<PlanComptableImportPreviewResponseDto> {
    const parsed = await this.parseWorkbook(file);
    if ('fileErrors' in parsed) {
      return {
        rows: [],
        totalRowCount: 0,
        truncated: false,
        createCount: 0,
        updateCount: 0,
        errors: parsed.fileErrors,
      };
    }

    const { planned, errors } = await this.plan(company, parsed.rows);
    const sample = planned.slice(0, PREVIEW_SAMPLE_SIZE);
    return {
      rows: sample.map(toRowDto),
      totalRowCount: planned.length,
      truncated: planned.length > sample.length,
      createCount: planned.filter((r) => r.action === 'CREATE').length,
      updateCount: planned.filter((r) => r.action === 'UPDATE').length,
      errors,
    };
  }

  async confirmImport(
    company: CompanyContext,
    file: ImportedPlanComptableFile,
  ): Promise<PlanComptableImportResultDto> {
    const parsed = await this.parseWorkbook(file);
    if ('fileErrors' in parsed) {
      throw new BadRequestException(parsed.fileErrors.join(' '));
    }

    const { planned, errors } = await this.plan(company, parsed.rows);
    if (errors.length > 0) {
      throw new ConflictException(
        `Import refusé — ${errors.length} erreur(s) : ${errors.join(' ')}`,
      );
    }

    let createdCount = 0;
    let updatedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      const idByNumber = new Map<string, string>();

      // Pass 1: plain accounts first, so a tiers row in pass 2 can resolve
      // a parent created/updated within this very same file.
      for (const row of planned) {
        if (row.parentNumber) continue;
        const account = await tx.account.upsert({
          where: { companyId_number: { companyId: company.companyId, number: row.number } },
          create: {
            companyId: company.companyId,
            number: row.number,
            label: row.label,
            pcgClass: row.pcgClass,
            isAuxiliary: false,
            addressLine: row.addressLine,
            postalCode: row.postalCode,
            city: row.city,
            countryCode: row.countryCode,
            sirenOrRci: row.sirenOrRci,
            vatNumber: row.vatNumber,
          },
          update: {
            label: row.label,
            addressLine: row.addressLine,
            postalCode: row.postalCode,
            city: row.city,
            countryCode: row.countryCode,
            sirenOrRci: row.sirenOrRci,
            vatNumber: row.vatNumber,
          },
        });
        idByNumber.set(row.number, account.id);
        if (row.action === 'CREATE') createdCount++;
        else updatedCount++;
      }

      // Pass 2: tiers rows — parent resolved from pass 1's map, or from
      // plan()'s own pre-fetched DB lookup for a parent not in this file.
      for (const row of planned) {
        if (!row.parentNumber) continue;
        const parentId = idByNumber.get(row.parentNumber) ?? row.resolvedParentId;
        if (!parentId) {
          // Unreachable — plan() already validated every parent resolves —
          // but never silently skip a row instead of failing loud.
          throw new ConflictException(
            `Compte parent "${row.parentNumber}" introuvable pour le compte "${row.number}".`,
          );
        }
        const parent = await tx.account.findUniqueOrThrow({ where: { id: parentId } });
        const account = await tx.account.upsert({
          where: { companyId_number: { companyId: company.companyId, number: row.number } },
          create: {
            companyId: company.companyId,
            number: row.number,
            label: row.label,
            pcgClass: parent.pcgClass,
            isAuxiliary: true,
            parentId,
            addressLine: row.addressLine,
            postalCode: row.postalCode,
            city: row.city,
            countryCode: row.countryCode,
            sirenOrRci: row.sirenOrRci,
            vatNumber: row.vatNumber,
          },
          update: {
            label: row.label,
            addressLine: row.addressLine,
            postalCode: row.postalCode,
            city: row.city,
            countryCode: row.countryCode,
            sirenOrRci: row.sirenOrRci,
            vatNumber: row.vatNumber,
          },
        });
        idByNumber.set(row.number, account.id);
        if (row.action === 'CREATE') createdCount++;
        else updatedCount++;
      }
    });

    return { createdCount, updatedCount };
  }

  /**
   * Validates and classifies every row into CREATE/UPDATE, resolving
   * tiers parents either against another row in the same file or an
   * existing DB account — mirrors FEC import's own "auxiliary accounts
   * inherit their parent collectif's pcgClass, never their own leading
   * digit" rule (see CLAUDE.md "FEC file import"). Never throws — every
   * problem becomes an entry in `errors`, so preview() can show the
   * caller every mistake at once rather than one at a time.
   */
  private async plan(
    company: CompanyContext,
    rows: ParsedRow[],
  ): Promise<{ planned: PlannedRow[]; errors: string[] }> {
    const errors: string[] = [];

    const firstRowByNumber = new Map<string, number>();
    for (const row of rows) {
      const firstRow = firstRowByNumber.get(row.number);
      if (firstRow !== undefined) {
        errors.push(
          `Ligne ${row.rowNumber}: le numéro de compte "${row.number}" apparaît déjà à la ligne ${firstRow}.`,
        );
      } else {
        firstRowByNumber.set(row.number, row.rowNumber);
      }
    }

    const rowsByNumber = new Map(rows.map((r) => [r.number, r]));

    const existingAccounts = await this.prisma.account.findMany({
      where: { companyId: company.companyId, number: { in: rows.map((r) => r.number) } },
    });
    const existingByNumber = new Map(existingAccounts.map((a) => [a.number, a]));

    const parentNumbersNeedingDbLookup = [
      ...new Set(
        rows
          .filter((r) => r.parentNumber && !rowsByNumber.has(r.parentNumber))
          .map((r) => r.parentNumber as string),
      ),
    ];
    const dbParents = parentNumbersNeedingDbLookup.length
      ? await this.prisma.account.findMany({
          where: { companyId: company.companyId, number: { in: parentNumbersNeedingDbLookup } },
        })
      : [];
    const dbParentByNumber = new Map(dbParents.map((a) => [a.number, a]));

    const planned: PlannedRow[] = [];

    for (const row of rows) {
      if (firstRowByNumber.get(row.number) !== row.rowNumber) continue; // duplicate — already errored

      if (!row.parentNumber) {
        let pcgClass: number;
        try {
          pcgClass = resolvePcgClass(row.number);
        } catch (error) {
          errors.push(`Ligne ${row.rowNumber}: ${describeError(error)}`);
          continue;
        }
        const existing = existingByNumber.get(row.number);
        planned.push({
          ...row,
          pcgClass,
          isAuxiliary: false,
          action: existing ? 'UPDATE' : 'CREATE',
        });
        continue;
      }

      if (row.parentNumber === row.number) {
        errors.push(
          `Ligne ${row.rowNumber}: le compte "${row.number}" ne peut pas être son propre compte parent.`,
        );
        continue;
      }

      const parentRowInFile = rowsByNumber.get(row.parentNumber);
      let parentPcgClass: number;
      let resolvedParentId: string | undefined;

      if (parentRowInFile) {
        if (parentRowInFile.parentNumber) {
          errors.push(
            `Ligne ${row.rowNumber}: le compte parent "${row.parentNumber}" est lui-même un ` +
              'compte auxiliaire (tiers imbriqués non autorisés).',
          );
          continue;
        }
        if (!isAuxiliaryBearingCollectif(row.parentNumber)) {
          errors.push(
            `Ligne ${row.rowNumber}: "${row.parentNumber}" n'est pas un compte collectif ` +
              'acceptant des tiers (401, 411 ou 455 uniquement).',
          );
          continue;
        }
        try {
          parentPcgClass = resolvePcgClass(row.parentNumber);
        } catch (error) {
          errors.push(`Ligne ${row.rowNumber}: ${describeError(error)}`);
          continue;
        }
      } else {
        const dbParent = dbParentByNumber.get(row.parentNumber);
        if (!dbParent) {
          errors.push(
            `Ligne ${row.rowNumber}: compte parent "${row.parentNumber}" introuvable (ni dans ` +
              'le fichier, ni dans le plan comptable existant).',
          );
          continue;
        }
        if (dbParent.isAuxiliary) {
          errors.push(
            `Ligne ${row.rowNumber}: le compte parent "${row.parentNumber}" est lui-même un ` +
              'compte auxiliaire.',
          );
          continue;
        }
        if (!isAuxiliaryBearingCollectif(dbParent.number)) {
          errors.push(
            `Ligne ${row.rowNumber}: "${row.parentNumber}" n'est pas un compte collectif ` +
              'acceptant des tiers (401, 411 ou 455 uniquement).',
          );
          continue;
        }
        parentPcgClass = dbParent.pcgClass;
        resolvedParentId = dbParent.id;
      }

      const existing = existingByNumber.get(row.number);
      planned.push({
        ...row,
        pcgClass: parentPcgClass,
        isAuxiliary: true,
        action: existing ? 'UPDATE' : 'CREATE',
        resolvedParentId,
      });
    }

    return { planned, errors };
  }

  private async parseWorkbook(
    file: ImportedPlanComptableFile,
  ): Promise<{ rows: ParsedRow[] } | { fileErrors: string[] }> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch (error) {
      return {
        fileErrors: [`Impossible de lire le fichier .xlsx (${describeError(error)}).`],
      };
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) return { fileErrors: ['Le classeur ne contient aucune feuille.'] };

    const columnIndex = new Map<string, number>();
    worksheet.getRow(1).eachCell((cell, colNumber) => {
      const name = cellValueToString(cell.value).trim();
      if (name) columnIndex.set(name, colNumber);
    });
    const missing = REQUIRED_COLUMNS.filter((name) => !columnIndex.has(name));
    if (missing.length > 0) {
      return { fileErrors: [`Colonne(s) obligatoire(s) manquante(s) : ${missing.join(', ')}.`] };
    }

    const get = (row: ExcelJS.Row, name: string): string => {
      const index = columnIndex.get(name);
      return index ? cellValueToString(row.getCell(index).value).trim() : '';
    };

    const rows: ParsedRow[] = [];
    const rowErrors: string[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (row.cellCount === 0) return;
      const number = get(row, 'CompteNum');
      const label = get(row, 'CompteLib');
      if (!number || !label) {
        rowErrors.push(`Ligne ${rowNumber}: CompteNum et CompteLib sont obligatoires.`);
        return;
      }
      rows.push({
        rowNumber,
        number,
        label,
        parentNumber: get(row, 'CompteParentNum') || null,
        addressLine: get(row, 'Adresse') || undefined,
        postalCode: get(row, 'CodePostal') || undefined,
        city: get(row, 'Ville') || undefined,
        countryCode: get(row, 'PaysISO') || undefined,
        sirenOrRci: get(row, 'SirenRci') || undefined,
        vatNumber: get(row, 'NumeroTva') || undefined,
      });
    });

    if (rowErrors.length > 0) return { fileErrors: rowErrors };
    if (rows.length === 0)
      return { fileErrors: ['La feuille ne contient aucune ligne de données.'] };
    return { rows };
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
