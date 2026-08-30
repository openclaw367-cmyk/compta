-- CreateEnum
CREATE TYPE "RegimeTvaServices" AS ENUM ('ENCAISSEMENTS', 'DEBITS');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "bic" TEXT,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "regimeTvaServices" "RegimeTvaServices" NOT NULL DEFAULT 'ENCAISSEMENTS';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "encaissementConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "encaissementEcritureId" TEXT;
