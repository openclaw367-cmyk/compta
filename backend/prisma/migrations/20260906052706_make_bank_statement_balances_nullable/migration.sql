-- AlterTable
ALTER TABLE "BankStatementImport" ALTER COLUMN "openingBalance" DROP NOT NULL,
ALTER COLUMN "closingBalance" DROP NOT NULL;
