-- CreateEnum
CREATE TYPE "SheetSyncCadence" AS ENUM ('MANUAL', 'DAILY', 'WEEKLY');

-- AlterEnum
ALTER TYPE "ProposedActionKind" ADD VALUE 'CREATE_GOAL';

-- CreateTable
CREATE TABLE "sheet_sources" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetName" TEXT,
    "range" TEXT,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "syncCadence" "SheetSyncCadence" NOT NULL DEFAULT 'WEEKLY',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "preUpdateReminderEnabled" BOOLEAN NOT NULL DEFAULT true,
    "preUpdateReminderHoursBefore" INTEGER NOT NULL DEFAULT 24,
    "lastReminderSentAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sheet_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sheet_sources_userId_idx" ON "sheet_sources"("userId");

-- CreateIndex
CREATE INDEX "sheet_sources_enabled_syncCadence_lastSyncedAt_idx" ON "sheet_sources"("enabled", "syncCadence", "lastSyncedAt");

-- AddForeignKey
ALTER TABLE "sheet_sources" ADD CONSTRAINT "sheet_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_sources" ADD CONSTRAINT "sheet_sources_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "external_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sheet_sources" ADD CONSTRAINT "sheet_sources_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
