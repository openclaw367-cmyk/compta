-- AlterTable
ALTER TABLE "EcritureLigne" ADD COLUMN     "vatRateId" TEXT;

-- AddForeignKey
ALTER TABLE "EcritureLigne" ADD CONSTRAINT "EcritureLigne_vatRateId_fkey" FOREIGN KEY ("vatRateId") REFERENCES "VatRate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
