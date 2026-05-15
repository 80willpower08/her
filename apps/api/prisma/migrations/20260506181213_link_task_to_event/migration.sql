-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "linkedCalendarEventId" TEXT;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_linkedCalendarEventId_fkey" FOREIGN KEY ("linkedCalendarEventId") REFERENCES "calendar_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
