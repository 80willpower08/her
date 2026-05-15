-- DropIndex
DROP INDEX "notifications_userId_sourceType_sourceId_kind_idx";

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "sourceVersion" TEXT;

-- CreateIndex
CREATE INDEX "notifications_userId_sourceType_sourceId_kind_sourceVersion_idx" ON "notifications"("userId", "sourceType", "sourceId", "kind", "sourceVersion");
