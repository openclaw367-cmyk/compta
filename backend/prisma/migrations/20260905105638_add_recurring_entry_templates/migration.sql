-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateTable
CREATE TABLE "RecurringEntryTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "frequency" "RecurrenceFrequency",
    "anchorDay" INTEGER,
    "anchorMonth" INTEGER,
    "lastAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringEntryTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringEntryTemplateLine" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "auxAccountNumber" TEXT,
    "vatRateId" TEXT,
    "debit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "RecurringEntryTemplateLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringEntryTemplate_companyId_idx" ON "RecurringEntryTemplate"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringEntryTemplate_companyId_name_key" ON "RecurringEntryTemplate"("companyId", "name");

-- CreateIndex
CREATE INDEX "RecurringEntryTemplateLine_templateId_idx" ON "RecurringEntryTemplateLine"("templateId");

-- AddForeignKey
ALTER TABLE "RecurringEntryTemplate" ADD CONSTRAINT "RecurringEntryTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEntryTemplate" ADD CONSTRAINT "RecurringEntryTemplate_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEntryTemplateLine" ADD CONSTRAINT "RecurringEntryTemplateLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "RecurringEntryTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEntryTemplateLine" ADD CONSTRAINT "RecurringEntryTemplateLine_vatRateId_fkey" FOREIGN KEY ("vatRateId") REFERENCES "VatRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
