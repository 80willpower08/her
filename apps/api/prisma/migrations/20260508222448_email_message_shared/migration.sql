-- CreateEnum
CREATE TYPE "EmailSource" AS ENUM ('GMAIL', 'OUTLOOK', 'SHARED');

-- CreateEnum
CREATE TYPE "EmailTriageStatus" AS ENUM ('NONE', 'PENDING', 'CONVERTED_TO_TASK', 'ATTACHED_TO_GOAL', 'NOTED', 'DISCARDED');

-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "source" "EmailSource" NOT NULL DEFAULT 'GMAIL',
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "triageStatus" "EmailTriageStatus" NOT NULL DEFAULT 'NONE',
ALTER COLUMN "externalAccountId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "email_messages_userId_triageStatus_receivedAt_idx" ON "email_messages"("userId", "triageStatus", "receivedAt");
