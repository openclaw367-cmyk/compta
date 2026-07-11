import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { CompanyContextMiddleware } from './common/tenant/company-context.middleware';
import { CompaniesModule } from './modules/companies/companies.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { JournalsModule } from './modules/journals/journals.module';
import { FiscalYearsModule } from './modules/fiscal-years/fiscal-years.module';
import { EntriesModule } from './modules/entries/entries.module';
import { FecModule } from './modules/fec/fec.module';
import { ImportExcelModule } from './modules/import-excel/import-excel.module';
import { DepreciationModule } from './modules/depreciation/depreciation.module';
import { VatModule } from './modules/vat/vat.module';
import { LiasseModule } from './modules/liasse/liasse.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CompaniesModule,
    AccountsModule,
    JournalsModule,
    FiscalYearsModule,
    EntriesModule,
    FecModule,
    ImportExcelModule,
    DepreciationModule,
    VatModule,
    LiasseModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route except company creation itself needs a resolved tenant.
    // See CLAUDE.md "Multi-tenant data model".
    consumer
      .apply(CompanyContextMiddleware)
      .exclude({ path: 'companies', method: RequestMethod.POST })
      .forRoutes('*');
  }
}
