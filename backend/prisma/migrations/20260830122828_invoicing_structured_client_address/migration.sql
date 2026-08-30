/*
  Warnings:

  - You are about to drop the column `clientAddressSnapshot` on the `Invoice` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "clientAddressSnapshot",
ADD COLUMN     "clientAddressLineSnapshot" TEXT,
ADD COLUMN     "clientCitySnapshot" TEXT,
ADD COLUMN     "clientCountrySnapshot" TEXT,
ADD COLUMN     "clientPostalCodeSnapshot" TEXT;
