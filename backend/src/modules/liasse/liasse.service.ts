import {
  ConflictException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import { computeFixedAssetSummary } from '../depreciation/fixed-asset-invariants';
import { ComputeLiasseDto } from './dto/compute-liasse.dto';
import { LiasseLigne, buildTrialBalance } from './trial-balance-engine';
import { Bilan2050, computeBilan2050, resolveImmobilisationLineCode } from './bilan-2050';
import {
  CompteResultat2052_2053,
  computeCompteResultat2052_2053,
} from './compte-resultat-2052-2053';
import { VncCheckLine, assertLiasseArticulation } from './liasse-articulation';

export interface LiasseResult {
  bilan: Bilan2050;
  compteResultat: CompteResultat2052_2053;
}

/**
 * Liasse fiscale, régime réel normal (2050-series) — bilan + compte de
 * résultat only, see specs/liasse-2050-implementation-spec.md. The
 * 2033-series (régime réel simplifié) mapping doesn't exist yet — a
 * REEL_SIMPLIFIE company is refused explicitly rather than silently
 * handed a réel-normal liasse, same discipline as
 * VatService.computeDeclaration()'s jurisdiction guard.
 *
 * Only validated écritures are read, and the whole computation refuses
 * if any écriture in the fiscal year is still a draft — same rule as
 * FEC/CA3/Monaco. Class 8 (comptes spéciaux — off-balance-sheet
 * commitments) is excluded from both the bilan and the compte de
 * résultat: per Règlement ANC 2014-03 art. 934-3, class 8 exists purely
 * "pour satisfaire à des exigences d'information", not as part of
 * either statutory statement.
 */
@Injectable()
export class LiasseService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(company: CompanyContext, dto: ComputeLiasseDto): Promise<LiasseResult> {
    const companyRecord = await this.prisma.company.findFirst({ where: { id: company.companyId } });
    if (!companyRecord) {
      throw new NotFoundException(`Company ${company.companyId} not found`);
    }
    if (companyRecord.regime !== 'REEL_NORMAL') {
      throw new NotImplementedException(
        `Liasse fiscale for regime "${companyRecord.regime}" is not implemented yet — only ` +
          'REEL_NORMAL (2050-series) is built so far. See specs/liasse-2050-implementation-spec.md.',
      );
    }

    const fiscalYear = await this.prisma.fiscalYear.findFirst({
      where: { id: dto.fiscalYearId, companyId: company.companyId },
    });
    if (!fiscalYear) {
      throw new NotFoundException(`Fiscal year ${dto.fiscalYearId} not found`);
    }

    const draftCount = await this.prisma.ecriture.count({
      where: { companyId: company.companyId, fiscalYearId: fiscalYear.id, validatedAt: null },
    });
    if (draftCount > 0) {
      throw new ConflictException(
        `Cannot generate the liasse: ${draftCount} écriture(s) in this fiscal year are still ` +
          'unvalidated (draft). Validate them first.',
      );
    }

    const lignes = await this.prisma.ecritureLigne.findMany({
      where: {
        companyId: company.companyId,
        ecriture: { fiscalYearId: fiscalYear.id, validatedAt: { not: null } },
      },
      include: { compte: true },
    });
    const mappedLignes: LiasseLigne[] = lignes.map((ligne) => ({
      compteNumber: ligne.compte.number,
      pcgClass: ligne.compte.pcgClass,
      debit: ligne.debit,
      credit: ligne.credit,
    }));
    const trialBalance = buildTrialBalance(mappedLignes);

    const bilanAccounts = trialBalance.filter((a) => a.pcgClass >= 1 && a.pcgClass <= 5);
    const compteResultatAccounts = trialBalance.filter((a) => a.pcgClass === 6 || a.pcgClass === 7);
    // Class 8 accounts, if any, are neither bilan nor compte de résultat — silently excluded, not
    // silently mismapped (see doc comment above).

    const compteResultat = computeCompteResultat2052_2053(compteResultatAccounts);
    const bilan = computeBilan2050(bilanAccounts, Money.fromString(compteResultat.beneficeOuPerte));

    const vncByLine = await this.buildVncByLine(company, fiscalYear.endDate);
    assertLiasseArticulation({ bilan, vncByLine });

    return { bilan, compteResultat };
  }

  /**
   * Groups every FixedAsset by the Actif line its account rolls up to,
   * summing valeurBrute/amortissementsCumules per line using the same
   * formula as the immobilisations module itself
   * (fixed-asset-invariants.ts) — never re-derived. Depreciation entries
   * posted in a LATER fiscal year than the one being reported are
   * excluded, so this stays comparable to the trial balance, which is
   * scoped to the same fiscal year.
   */
  private async buildVncByLine(
    company: CompanyContext,
    asOfEndDate: Date,
  ): Promise<VncCheckLine[]> {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { companyId: company.companyId },
      include: {
        account: true,
        depreciationEntries: {
          where: { postedEcritureId: { not: null }, fiscalYear: { endDate: { lte: asOfEndDate } } },
        },
      },
    });

    const byLine = new Map<string, { valeurBrute: Money; amortissementsCumules: Money }>();
    for (const asset of assets) {
      const summary = computeFixedAssetSummary(asset, asset.depreciationEntries);
      const lineCode = resolveImmobilisationLineCode(asset.account.number);
      const existing = byLine.get(lineCode) ?? {
        valeurBrute: Money.zero(),
        amortissementsCumules: Money.zero(),
      };
      byLine.set(lineCode, {
        valeurBrute: existing.valeurBrute.plus(summary.valeurBrute),
        amortissementsCumules: existing.amortissementsCumules.plus(summary.amortissementsCumules),
      });
    }

    return Array.from(byLine.entries()).map(([code, totals]) => ({ code, ...totals }));
  }
}
