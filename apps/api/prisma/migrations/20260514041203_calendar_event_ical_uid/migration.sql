-- AlterTable
ALTER TABLE "calendar_events" ADD COLUMN     "iCalUid" TEXT;

-- CreateIndex
CREATE INDEX "calendar_events_userId_iCalUid_idx" ON "calendar_events"("userId", "iCalUid");
