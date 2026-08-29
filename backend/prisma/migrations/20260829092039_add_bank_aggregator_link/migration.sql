-- CreateEnum
CREATE TYPE "BankAggregatorProvider" AS ENUM ('BRIDGE');

-- CreateEnum
CREATE TYPE "BankAggregatorLinkStatus" AS ENUM ('ACTIVE', 'REVOKED', 'ERROR');

-- CreateTable
CREATE TABLE "BankAggregatorLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "provider" "BankAggregatorProvider" NOT NULL,
    "externalItemId" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "maskedAccessToken" TEXT NOT NULL,
    "status" "BankAggregatorLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAggregatorLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankAggregatorLink_bankAccountId_key" ON "BankAggregatorLink"("bankAccountId");

-- CreateIndex
CREATE INDEX "BankAggregatorLink_companyId_idx" ON "BankAggregatorLink"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAggregatorLink_companyId_provider_externalItemId_key" ON "BankAggregatorLink"("companyId", "provider", "externalItemId");

-- AddForeignKey
ALTER TABLE "BankAggregatorLink" ADD CONSTRAINT "BankAggregatorLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAggregatorLink" ADD CONSTRAINT "BankAggregatorLink_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
