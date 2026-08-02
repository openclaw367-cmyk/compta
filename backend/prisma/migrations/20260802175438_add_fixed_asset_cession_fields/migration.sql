-- AlterTable
ALTER TABLE "FixedAsset" ADD COLUMN     "cessionDate" TIMESTAMP(3),
ADD COLUMN     "cessionPrice" DECIMAL(15,2);
