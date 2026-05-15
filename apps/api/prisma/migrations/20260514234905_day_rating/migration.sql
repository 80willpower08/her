-- CreateTable
CREATE TABLE "day_ratings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "day_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "day_ratings_userId_dateKey_idx" ON "day_ratings"("userId", "dateKey");

-- CreateIndex
CREATE UNIQUE INDEX "day_ratings_userId_dateKey_key" ON "day_ratings"("userId", "dateKey");

-- AddForeignKey
ALTER TABLE "day_ratings" ADD CONSTRAINT "day_ratings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
