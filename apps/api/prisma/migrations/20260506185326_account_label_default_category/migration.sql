-- AlterTable
ALTER TABLE "external_accounts" ADD COLUMN     "defaultCategoryId" TEXT,
ADD COLUMN     "label" TEXT;

-- AddForeignKey
ALTER TABLE "external_accounts" ADD CONSTRAINT "external_accounts_defaultCategoryId_fkey" FOREIGN KEY ("defaultCategoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
