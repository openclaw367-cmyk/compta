import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BankReconciliationModule } from '../bank-reconciliation/bank-reconciliation.module';
import { BankAggregatorController } from './bank-aggregator.controller';
import { BankAggregatorLinkService } from './bank-aggregator-link.service';
import { BANK_AGGREGATOR_PORT } from './bank-aggregator.port';
import { BridgeAggregatorAdapter } from './providers/bridge-aggregator.adapter';

/**
 * Binds Bridge as the default `BANK_AGGREGATOR_PORT` (the only provider
 * this pass ships — see CLAUDE.md "Bank reconciliation — Layer 1b").
 * `BridgeAggregatorAdapter` is deliberately not `@Injectable` (see its own
 * doc comment), so it's constructed via `useFactory` rather than
 * `useClass` — same reasoning `ClaudeCloudModelAdapter`/
 * `DeepSeekCloudModelAdapter` document, applied to Nest's DI mechanics
 * specifically for this one "default" binding.
 * `BankStatementImportService` (from `BankReconciliationModule`) is
 * reused verbatim for persistence — see
 * `bank-aggregator-link.service.ts`'s own doc comment.
 */
@Module({
  imports: [BankReconciliationModule],
  controllers: [BankAggregatorController],
  providers: [
    BankAggregatorLinkService,
    {
      provide: BANK_AGGREGATOR_PORT,
      useFactory: (config: ConfigService) => new BridgeAggregatorAdapter(config),
      inject: [ConfigService],
    },
  ],
})
export class BankAggregatorModule {}
