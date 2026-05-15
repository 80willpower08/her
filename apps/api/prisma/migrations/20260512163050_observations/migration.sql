-- CreateEnum
CREATE TYPE "ObservationKind" AS ENUM ('FACT', 'PATTERN', 'PREFERENCE', 'COMMITMENT', 'INSIGHT', 'CONCERN');

-- CreateEnum
CREATE TYPE "CommitmentEnforce" AS ENUM ('NORMAL', 'BLOCK');

-- CreateTable
CREATE TABLE "observations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ObservationKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "source" TEXT NOT NULL,
    "sourceRunId" TEXT,
    "sourceThreadId" TEXT,
    "relatedCategoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedGoalIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relatedTaskIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enforceLevel" "CommitmentEnforce" NOT NULL DEFAULT 'NORMAL',
    "supersedesId" TEXT,
    "supersededAt" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "confirmedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "observations_supersedesId_key" ON "observations"("supersedesId");

-- CreateIndex
CREATE INDEX "observations_userId_kind_supersededAt_archived_idx" ON "observations"("userId", "kind", "supersededAt", "archived");

-- CreateIndex
CREATE INDEX "observations_userId_createdAt_idx" ON "observations"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_sourceThreadId_fkey" FOREIGN KEY ("sourceThreadId") REFERENCES "chat_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observations" ADD CONSTRAINT "observations_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
