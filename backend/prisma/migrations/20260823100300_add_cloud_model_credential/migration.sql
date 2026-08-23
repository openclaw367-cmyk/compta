-- CreateEnum
CREATE TYPE "CloudModelProvider" AS ENUM ('CLAUDE', 'DEEPSEEK');

-- CreateTable
CREATE TABLE "CloudModelCredential" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" "CloudModelProvider" NOT NULL,
    "encryptedApiKey" TEXT NOT NULL,
    "maskedKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloudModelCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CloudModelCredential_companyId_idx" ON "CloudModelCredential"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CloudModelCredential_companyId_provider_key" ON "CloudModelCredential"("companyId", "provider");

-- AddForeignKey
ALTER TABLE "CloudModelCredential" ADD CONSTRAINT "CloudModelCredential_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
