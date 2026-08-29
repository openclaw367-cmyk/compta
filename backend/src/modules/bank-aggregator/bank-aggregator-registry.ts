import { ConfigService } from '@nestjs/config';
import { BankAggregatorProvider } from '@prisma/client';
import { BankAggregatorPort } from './bank-aggregator.port';
import { BridgeAggregatorAdapter } from './providers/bridge-aggregator.adapter';

/**
 * The one place that switches on `BankAggregatorProvider` — mirrors
 * `chat-model/cloud-model-registry.ts`'s `createCloudModelAdapter()`
 * exactly. Adding a second provider (e.g. Powens) is a new case here
 * plus a new adapter class, never a change to `BankAggregatorLinkService`.
 */
export function createBankAggregatorAdapter(
  provider: BankAggregatorProvider,
  config: ConfigService,
): BankAggregatorPort {
  switch (provider) {
    case BankAggregatorProvider.BRIDGE:
      return new BridgeAggregatorAdapter(config);
  }
}
