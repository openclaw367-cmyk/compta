-- CreateEnum
CREATE TYPE "ArchivedExportKind" AS ENUM ('FEC');

-- CreateTable
CREATE TABLE "ArchivedExport" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "kind" "ArchivedExportKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchivedExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArchivedExport_companyId_idx" ON "ArchivedExport"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchivedExport_companyId_fiscalYearId_kind_key" ON "ArchivedExport"("companyId", "fiscalYearId", "kind");

-- AddForeignKey
ALTER TABLE "ArchivedExport" ADD CONSTRAINT "ArchivedExport_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchivedExport" ADD CONSTRAINT "ArchivedExport_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
