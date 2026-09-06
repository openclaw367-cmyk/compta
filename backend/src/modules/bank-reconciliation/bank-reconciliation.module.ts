import { Module } from '@nestjs/common';
import { EntriesModule } from '../entries/entries.module';
import { BankReconciliationController } from './bank-reconciliation.controller';
import { BankStatementImportService } from './bank-statement-import.service';
import { BankReconciliationService } from './bank-reconciliation.service';
import { Camt053ParserService } from './camt053-parser.service';
import { CsvStatementParserService } from './csv-statement-parser.service';

@Module({
  imports: [EntriesModule],
  controllers: [BankReconciliationController],
  providers: [
    Camt053ParserService,
    CsvStatementParserService,
    BankStatementImportService,
    BankReconciliationService,
  ],
  // BankStatementImportService is reused by BankAggregatorModule (Layer
  // 1b) so a live sync can call its persistParsedStatement() verbatim —
  // see CLAUDE.md "Bank reconciliation — Layer 1b".
  exports: [BankStatementImportService],
})
export class BankReconciliationModule {}
