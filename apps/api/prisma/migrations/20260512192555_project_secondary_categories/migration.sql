-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "secondaryCategoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
