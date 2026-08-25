-- CreateEnum
CREATE TYPE "DocumentAuditAction" AS ENUM ('ATTACHED', 'REPLACED', 'REMOVED');

-- CreateTable
CREATE TABLE "EcritureDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ecritureId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcritureDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcritureDocumentAuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ecritureId" TEXT NOT NULL,
    "action" "DocumentAuditAction" NOT NULL,
    "fileName" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcritureDocumentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EcritureDocument_companyId_ecritureId_idx" ON "EcritureDocument"("companyId", "ecritureId");

-- CreateIndex
CREATE INDEX "EcritureDocumentAuditLog_companyId_ecritureId_idx" ON "EcritureDocumentAuditLog"("companyId", "ecritureId");

-- AddForeignKey
ALTER TABLE "EcritureDocument" ADD CONSTRAINT "EcritureDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcritureDocument" ADD CONSTRAINT "EcritureDocument_ecritureId_fkey" FOREIGN KEY ("ecritureId") REFERENCES "Ecriture"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcritureDocumentAuditLog" ADD CONSTRAINT "EcritureDocumentAuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
