-- CreateEnum
CREATE TYPE "ChatEngine" AS ENUM ('LOCAL', 'CLOUD');

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "cloudProvider" "CloudModelProvider",
ADD COLUMN     "engine" "ChatEngine" NOT NULL DEFAULT 'LOCAL';
