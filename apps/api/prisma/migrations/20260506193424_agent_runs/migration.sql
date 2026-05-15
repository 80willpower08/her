-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('ORCHESTRATOR', 'PRIORITIZATION', 'EMAIL_TRIAGE', 'CALENDAR_CONFLICT', 'STATUS_SUMMARY');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'OK', 'ERROR', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProposedActionKind" AS ENUM ('POST_NOTE', 'CREATE_TASK', 'UPDATE_TASK', 'COMPLETE_TASK', 'ADJUST_WEIGHT', 'RESCHEDULE_TASK', 'LINK_TASK_TO_EVENT', 'ARCHIVE_TASK', 'DECLINE_MEETING');

-- CreateEnum
CREATE TYPE "ProposedActionMode" AS ENUM ('AUTO', 'REVIEW', 'ASK');

-- CreateEnum
CREATE TYPE "ProposedActionStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'EXECUTED', 'EXPIRED', 'FAILED');

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AgentKind" NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "inputContext" JSONB,
    "rawOutput" TEXT,
    "decision" JSONB,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposed_actions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentRunId" TEXT NOT NULL,
    "kind" "ProposedActionKind" NOT NULL,
    "mode" "ProposedActionMode" NOT NULL,
    "status" "ProposedActionStatus" NOT NULL DEFAULT 'PENDING',
    "targetType" TEXT,
    "targetId" TEXT,
    "rationale" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposed_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_userId_kind_startedAt_idx" ON "agent_runs"("userId", "kind", "startedAt");

-- CreateIndex
CREATE INDEX "proposed_actions_userId_status_idx" ON "proposed_actions"("userId", "status");

-- CreateIndex
CREATE INDEX "proposed_actions_agentRunId_idx" ON "proposed_actions"("agentRunId");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposed_actions" ADD CONSTRAINT "proposed_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposed_actions" ADD CONSTRAINT "proposed_actions_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
