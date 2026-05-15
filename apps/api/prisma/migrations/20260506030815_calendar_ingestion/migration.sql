-- CreateEnum
CREATE TYPE "ExternalAccountKind" AS ENUM ('OAUTH', 'ICS_URL');

-- CreateEnum
CREATE TYPE "ExternalAccountProvider" AS ENUM ('GOOGLE', 'MICROSOFT', 'ICS');

-- CreateEnum
CREATE TYPE "ExternalAccountStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "CalendarEventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CalendarEventTransparency" AS ENUM ('BUSY', 'FREE');

-- CreateEnum
CREATE TYPE "IngestionRunStatus" AS ENUM ('RUNNING', 'OK', 'ERROR');

-- CreateTable
CREATE TABLE "external_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ExternalAccountKind" NOT NULL,
    "provider" "ExternalAccountProvider" NOT NULL,
    "accountEmail" TEXT,
    "displayName" TEXT,
    "accessTokenEncrypted" TEXT,
    "refreshTokenEncrypted" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "icsUrl" TEXT,
    "color" TEXT NOT NULL DEFAULT '#0ea5e9',
    "status" "ExternalAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "syncToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_events" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "sourceCalendarId" TEXT,
    "recurringEventId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "htmlLink" TEXT,
    "attendees" JSONB,
    "status" "CalendarEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "transparency" "CalendarEventTransparency" NOT NULL DEFAULT 'BUSY',
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_runs" (
    "id" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "IngestionRunStatus" NOT NULL DEFAULT 'RUNNING',
    "itemsFetched" INTEGER NOT NULL DEFAULT 0,
    "itemsCreated" INTEGER NOT NULL DEFAULT 0,
    "itemsUpdated" INTEGER NOT NULL DEFAULT 0,
    "itemsDeleted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "external_accounts_userId_idx" ON "external_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "external_accounts_userId_provider_accountEmail_key" ON "external_accounts"("userId", "provider", "accountEmail");

-- CreateIndex
CREATE INDEX "calendar_events_userId_startsAt_idx" ON "calendar_events"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "calendar_events_externalAccountId_startsAt_idx" ON "calendar_events"("externalAccountId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_events_externalAccountId_sourceEventId_key" ON "calendar_events"("externalAccountId", "sourceEventId");

-- CreateIndex
CREATE INDEX "ingestion_runs_externalAccountId_startedAt_idx" ON "ingestion_runs"("externalAccountId", "startedAt");

-- AddForeignKey
ALTER TABLE "external_accounts" ADD CONSTRAINT "external_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "external_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_externalAccountId_fkey" FOREIGN KEY ("externalAccountId") REFERENCES "external_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
