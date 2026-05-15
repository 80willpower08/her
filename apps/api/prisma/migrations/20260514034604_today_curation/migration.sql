-- CreateTable
CREATE TABLE "today_curations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "headline" TEXT NOT NULL DEFAULT '',
    "pinned" JSONB NOT NULL DEFAULT '[]',
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "today_curations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "today_curations_userId_key" ON "today_curations"("userId");

-- AddForeignKey
ALTER TABLE "today_curations" ADD CONSTRAINT "today_curations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "today_curations" ADD CONSTRAINT "today_curations_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
