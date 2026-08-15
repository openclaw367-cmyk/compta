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
import {
  VncCheckLine,
  assertLiasseArticulation,
  assertTableauxTieToBilan,
  assertTableau2056TiesToBilan,
  assertTableau2057TiesToBilan,
  assertTableau2059TiesToCompteResultat,
} from './liasse-articulation';
import { ImmobilisationMovementAsset, Tableau2054, computeTableau2054 } from './tableau-2054';
import {
  ImmobilisationDepreciationMovement,
  ImmobilisationDisposal,
  Tableau2055,
  computeTableau2055,
} from './tableau-2055';
import { ProvisionMovementLigne, Tableau2056, computeTableau2056 } from './tableau-2056';
import { PROVISION_ACCOUNT_CLASS_PREFIXES } from './provision-categories';
import { Tableau2057, computeTableau2057 } from './tableau-2057';
import { Tableau2059AAsset, Tableau2059A, computeTableau2059A } from './tableau-2059';

export interface LiasseResult {
  bilan: Bilan2050;
  compteResultat: CompteResultat2052_2053;
  tableau2054: Tableau2054;
  tableau2055: Tableau2055;
  tableau2056: Tableau2056;
  tableau2057: Tableau2057;
  tableau2059: Tableau2059A;
}

/**
 * Liasse fiscale, régime réel normal (2050-series) — bilan, compte de
 * résultat, the 2054/2055 immobilisations/amortissements movement
 * annexes, 2056 (provisions), 2057 (état des créances et des dettes,
 * montant brut only — see tableau-2057.ts for why the maturity split is
 * blocked), and 2059-A (plus/moins-values, a guarded always-empty
 * stub). See specs/liasse-2050-implementation-spec.md,
 * specs/liasse-2054-2055-implementation-spec.md, and
 * specs/liasse-2056-2059-implementation-spec.md for exactly what's
 * built vs. deferred on each. The 2033-series (régime réel simplifié)
 * mapping doesn't exist yet — a REEL_SIMPLIFIE company is refused
 * explicitly rather than silently handed a réel-normal liasse, same
 * discipline as VatService.computeDeclaration()'s jurisdiction guard.
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
      include: { compte: true, ecriture: { include: { journal: true } } },
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

    // One fetch, shared by the VNC check, 2054/2055, and 2059-A — scoped to "acquired in or before
    // the reported fiscal year, AND not disposed before it" (see fetchImmobilisations' own doc
    // comment for why both halves of that scoping are load-bearing, not incidental).
    const assets = await this.fetchImmobilisations(company, fiscalYear);
    const assetsDisposedThisYear = assets.filter(
      (asset) =>
        asset.cessionDate &&
        asset.cessionDate >= fiscalYear.startDate &&
        asset.cessionDate <= fiscalYear.endDate,
    );

    const vncByLine = this.buildVncByLine(assets, assetsDisposedThisYear);
    assertLiasseArticulation({ bilan, vncByLine });

    const tableau2054Assets: ImmobilisationMovementAsset[] = assets.map((asset) => ({
      accountNumber: asset.account.number,
      acquisitionDate: asset.acquisitionDate,
      acquisitionValue: Money.fromDecimal(asset.acquisitionValue),
      cessionDate: asset.cessionDate,
    }));
    const tableau2054 = computeTableau2054(tableau2054Assets, fiscalYear);

    const tableau2055Entries: ImmobilisationDepreciationMovement[] = assets.flatMap((asset) =>
      asset.depreciationEntries.map((entry) => ({
        accountNumber: asset.account.number,
        fiscalYearId: entry.fiscalYearId,
        fiscalYearEndDate: entry.fiscalYear.endDate,
        amount: Money.fromDecimal(entry.amount),
      })),
    );
    const tableau2055Disposals: ImmobilisationDisposal[] = assetsDisposedThisYear.map((asset) => ({
      accountNumber: asset.account.number,
      amortissementsCumules: computeFixedAssetSummary(asset, asset.depreciationEntries)
        .amortissementsCumules,
    }));
    const tableau2055 = computeTableau2055(
      tableau2055Entries,
      { id: fiscalYear.id, endDate: fiscalYear.endDate },
      tableau2055Disposals,
    );

    assertTableauxTieToBilan({ bilan, tableau2054, tableau2055 });

    const provisionLignes: ProvisionMovementLigne[] = lignes
      .filter((ligne) =>
        PROVISION_ACCOUNT_CLASS_PREFIXES.some((prefix) => ligne.compte.number.startsWith(prefix)),
      )
      .map((ligne) => ({
        accountNumber: ligne.compte.number,
        isOpeningBalance: ligne.ecriture.journal.type === 'A_NOUVEAU',
        debit: Money.fromDecimal(ligne.debit),
        credit: Money.fromDecimal(ligne.credit),
      }));
    const tableau2056 = computeTableau2056(provisionLignes);
    assertTableau2056TiesToBilan({ trialBalance: bilanAccounts, tableau2056 });

    const tableau2057 = computeTableau2057(bilan);
    assertTableau2057TiesToBilan({ bilan, tableau2057 });

    const tableau2059Assets: Tableau2059AAsset[] = assetsDisposedThisYear.map((asset) => {
      const summary = computeFixedAssetSummary(asset, asset.depreciationEntries);
      return {
        accountNumber: asset.account.number,
        cessionDate: asset.cessionDate!,
        cessionPrice: Money.fromDecimal(asset.cessionPrice!),
        valeurBrute: summary.valeurBrute,
        amortissementsCumules: summary.amortissementsCumules,
      };
    });
    const tableau2059 = computeTableau2059A(tableau2059Assets, fiscalYear);
    assertTableau2059TiesToCompteResultat({ compteResultat, tableau2059 });

    return {
      bilan,
      compteResultat,
      tableau2054,
      tableau2055,
      tableau2056,
      tableau2057,
      tableau2059,
    };
  }

  /**
   * Every FixedAsset acquired in or before the reported fiscal year AND
   * not disposed before it, with its posted depreciation entries from
   * that same fiscal year or earlier — the shared "as of this year"
   * dataset the VNC check, 2054/2055, and 2059-A all need.
   *
   * Both halves of the WHERE are load-bearing, fixed as real bugs, not
   * incidental: filtering only depreciationEntries and not the assets
   * themselves by acquisitionDate was the original bug (see git
   * history) — a company that later acquired more assets would get a
   * wrong VNC when reporting a past year. The cessionDate half is the
   * disposal-side analog, found while building cession support: without
   * it, an asset disposed in a PRIOR fiscal year would still contribute
   * its full valeurBrute/amortissementsCumules to every LATER year's
   * bilan forever (computeFixedAssetSummary's valeurBrute is always
   * FixedAsset.acquisitionValue, independent of disposal — see that
   * function's own doc comment), even though the asset is genuinely
   * gone and the ledger's own 21x/28x balances for it are already zero.
   * An asset disposed WITHIN the reported year is still included (its
   * 2054/2055/2059-A movement needs to show for that year); only a
   * disposal strictly BEFORE the reported year's start excludes it.
   */
  private async fetchImmobilisations(
    company: CompanyContext,
    fiscalYear: { startDate: Date; endDate: Date },
  ) {
    return this.prisma.fixedAsset.findMany({
      where: {
        companyId: company.companyId,
        acquisitionDate: { lte: fiscalYear.endDate },
        OR: [{ cessionDate: null }, { cessionDate: { gte: fiscalYear.startDate } }],
      },
      include: {
        account: true,
        depreciationEntries: {
          where: {
            postedEcritureId: { not: null },
            fiscalYear: { endDate: { lte: fiscalYear.endDate } },
          },
          include: { fiscalYear: true },
        },
      },
    });
  }

  /**
   * Groups the already-fetched assets by the Actif line their account
   * rolls up to, summing valeurBrute/amortissementsCumules per line
   * using the same formula as the immobilisations module itself
   * (fixed-asset-invariants.ts) — never re-derived.
   *
   * `disposedThisYear` assets are excluded from this tie-out entirely —
   * found live while adding cession support: computeFixedAssetSummary's
   * valeurBrute is always FixedAsset.acquisitionValue "independent of
   * residualValue or postings" (see that function's own doc comment),
   * so it keeps reporting a disposed asset's full historical gross
   * value forever, while the LEDGER (which this tie-out compares
   * against) correctly nets that same account to zero once the
   * disposal écriture's débit 28x/crédit 21x lines land. Comparing
   * those two for a disposed asset would always mismatch — not a bug
   * to paper over, a sign the two figures mean different things once
   * disposal exists. The bilan's own Actif=Passif check (a genuinely
   * separate, still-live tie-out) is what actually verifies the
   * disposal posted correctly.
   */
  private buildVncByLine(
    assets: Awaited<ReturnType<LiasseService['fetchImmobilisations']>>,
    disposedThisYear: Awaited<ReturnType<LiasseService['fetchImmobilisations']>>,
  ): VncCheckLine[] {
    const disposedIds = new Set(disposedThisYear.map((a) => a.id));
    const byLine = new Map<string, { valeurBrute: Money; amortissementsCumules: Money }>();
    for (const asset of assets) {
      if (disposedIds.has(asset.id)) {
        continue;
      }
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
