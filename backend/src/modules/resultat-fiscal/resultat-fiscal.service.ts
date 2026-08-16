import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyContext } from '../../common/tenant/company-context';
import { Money } from '../../common/decimal';
import {
  LiasseLigne,
  TrialBalanceAccount,
  buildTrialBalance,
} from '../liasse/trial-balance-engine';
import { computeCompteResultat2052_2053 } from '../liasse/compte-resultat-2052-2053';
import {
  CONFIRMABLE_LINE_ACCOUNT_PREFIXES,
  ResultatFiscalResult,
  assertResultatFiscalArithmetic,
  computeResultatFiscal,
} from './resultat-fiscal';
import { ComputeResultatFiscalDto } from './dto/compute-resultat-fiscal.dto';

/**
 * Détermination du résultat fiscal — see resultat-fiscal.ts for the
 * compute logic and every scope decision. This service is the fetch
 * layer: unlike cash-flow/financial-analysis, this module needs only
 * the CLOSING trial balance (no opening bilan, no immobilisations) —
 * a résultat fiscal worksheet has no delta/snapshot articulation to
 * verify, only the compte de résultat anchor and two raw-account
 * suggestions.
 */
@Injectable()
export class ResultatFiscalService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(
    company: CompanyContext,
    dto: ComputeResultatFiscalDto,
  ): Promise<ResultatFiscalResult> {
    const companyRecord = await this.prisma.company.findFirst({ where: { id: company.companyId } });
    if (!companyRecord) {
      throw new NotFoundException(`Company ${company.companyId} not found`);
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
        `Cannot compute the résultat fiscal: ${draftCount} écriture(s) in this fiscal year are ` +
          'still unvalidated (draft). Validate them first.',
      );
    }

    const lignes = await this.prisma.ecritureLigne.findMany({
      where: {
        companyId: company.companyId,
        ecriture: { fiscalYearId: fiscalYear.id, validatedAt: { not: null } },
      },
      include: { compte: true },
    });

    const closingLignes: LiasseLigne[] = lignes.map((ligne) => ({
      compteNumber: ligne.compte.number,
      pcgClass: ligne.compte.pcgClass,
      debit: ligne.debit,
      credit: ligne.credit,
    }));
    const closingTrialBalance = buildTrialBalance(closingLignes);
    const closingCdrAccounts = closingTrialBalance.filter(
      (a) => a.pcgClass === 6 || a.pcgClass === 7,
    );
    const closingCompteResultat = computeCompteResultat2052_2053(closingCdrAccounts);

    const closingChargesAccounts = closingTrialBalance.filter((a) => a.pcgClass === 6);
    const sumAccountBalance = (accounts: TrialBalanceAccount[], prefix: string): Money =>
      accounts
        .filter((a) => a.accountNumber.startsWith(prefix))
        .reduce((sum, a) => sum.plus(a.balance), Money.zero()); // balance = debit − credit, already positive for a normal charge
    const suggestedAmendesEtPenalites = sumAccountBalance(
      closingChargesAccounts,
      CONFIRMABLE_LINE_ACCOUNT_PREFIXES.WJ,
    );
    const suggestedTaxeVehicules = sumAccountBalance(
      closingChargesAccounts,
      CONFIRMABLE_LINE_ACCOUNT_PREFIXES.WG,
    );

    const confirmedAmendesEtPenalites = dto.confirmedAmendesEtPenalites
      ? Money.fromString(dto.confirmedAmendesEtPenalites)
      : suggestedAmendesEtPenalites;
    const confirmedTaxeVehicules = dto.confirmedTaxeVehicules
      ? Money.fromString(dto.confirmedTaxeVehicules)
      : suggestedTaxeVehicules;

    const result = computeResultatFiscal({
      closingCompteResultat,
      suggestedAmendesEtPenalites,
      confirmedAmendesEtPenalites,
      suggestedTaxeVehicules,
      confirmedTaxeVehicules,
      reintegrationsDeclarees: (dto.reintegrationsDeclarees ?? []).map((l) => ({
        code: l.code,
        label: l.label,
        montant: l.montant,
      })),
      deductionsDeclarees: (dto.deductionsDeclarees ?? []).map((l) => ({
        code: l.code,
        label: l.label,
        montant: l.montant,
      })),
    });
    assertResultatFiscalArithmetic(result);

    return result;
  }
}
