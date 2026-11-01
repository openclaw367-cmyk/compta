-- CreateEnum
CREATE TYPE "McpProposalStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "McpProposalToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dto" JSONB NOT NULL,
    "warnings" JSONB NOT NULL,
    "assumptions" JSONB NOT NULL,
    "status" "McpProposalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "McpProposalToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpProposalToken_tokenHash_key" ON "McpProposalToken"("tokenHash");

-- CreateIndex
CREATE INDEX "McpProposalToken_userId_companyId_status_idx" ON "McpProposalToken"("userId", "companyId", "status");

-- AddForeignKey
ALTER TABLE "McpProposalToken" ADD CONSTRAINT "McpProposalToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpProposalToken" ADD CONSTRAINT "McpProposalToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
