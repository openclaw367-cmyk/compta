-- DropForeignKey
ALTER TABLE "EcritureDocument" DROP CONSTRAINT "EcritureDocument_ecritureId_fkey";

-- AddForeignKey
ALTER TABLE "EcritureDocument" ADD CONSTRAINT "EcritureDocument_ecritureId_fkey" FOREIGN KEY ("ecritureId") REFERENCES "Ecriture"("id") ON DELETE CASCADE ON UPDATE CASCADE;
