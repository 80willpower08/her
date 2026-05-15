-- CreateEnum
CREATE TYPE "DataSourceAuthMode" AS ENUM ('NONE', 'BEARER', 'BASIC', 'COOKIE_LOGIN', 'CUSTOM_HEADERS');

-- CreateEnum
CREATE TYPE "DataSourceSyncCadence" AS ENUM ('MANUAL', 'HOURLY', 'DAILY', 'WEEKLY');

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "baseUrl" TEXT NOT NULL,
    "endpointPath" TEXT NOT NULL,
    "authMode" "DataSourceAuthMode" NOT NULL DEFAULT 'NONE',
    "authConfig" JSONB,
    "staticHeaders" JSONB,
    "categoryId" TEXT,
    "syncCadence" "DataSourceSyncCadence" NOT NULL DEFAULT 'DAILY',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "snapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_sources_userId_idx" ON "data_sources"("userId");

-- CreateIndex
CREATE INDEX "data_sources_enabled_syncCadence_lastSyncedAt_idx" ON "data_sources"("enabled", "syncCadence", "lastSyncedAt");

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
