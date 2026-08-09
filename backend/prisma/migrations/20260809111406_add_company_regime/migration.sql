-- CreateEnum
CREATE TYPE "Regime" AS ENUM ('REEL_NORMAL', 'REEL_SIMPLIFIE');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "regime" "Regime" NOT NULL DEFAULT 'REEL_NORMAL';
