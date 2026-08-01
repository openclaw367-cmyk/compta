-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'France',
ADD COLUMN     "postalCode" TEXT;
