-- CreateEnum
CREATE TYPE "SignalRuleSource" AS ENUM ('USER_AUTHORED', 'DEFAULT_SEED', 'AGENT_LEARNED');

-- AlterEnum
ALTER TYPE "NotificationPriority" ADD VALUE 'HIGH';

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "importance" "NotificationPriority" NOT NULL DEFAULT 'NORMAL';

-- CreateTable
CREATE TABLE "signal_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "sources" "EmailSource"[],
    "toMatches" TEXT[],
    "fromMatches" TEXT[],
    "subjectMatches" TEXT[],
    "bodyMatches" TEXT[],
    "labelMatches" TEXT[],
    "setImportance" "NotificationPriority",
    "addLabels" TEXT[],
    "pushToPhone" BOOLEAN NOT NULL DEFAULT true,
    "suppressDaily" BOOLEAN NOT NULL DEFAULT false,
    "source" "SignalRuleSource" NOT NULL DEFAULT 'USER_AUTHORED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "signal_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "signal_rules_userId_enabled_priority_idx" ON "signal_rules"("userId", "enabled", "priority");

-- AddForeignKey
ALTER TABLE "signal_rules" ADD CONSTRAINT "signal_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
