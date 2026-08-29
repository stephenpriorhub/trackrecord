-- Loading a publication's own published track-record spreadsheet.
--
-- Additive only. `SHEET_IMPORT` is added to the source enum but not used in this
-- migration, which is what lets `ALTER TYPE ... ADD VALUE` run inside the
-- transaction Prisma wraps each migration in.

-- AlterEnum
ALTER TYPE "ManagedSource" ADD VALUE 'SHEET_IMPORT';

-- AlterTable: a stable key for a non-Airtable import, so a re-run updates
-- rather than duplicating. Nullable, so every existing row is untouched.
ALTER TABLE "ManagedPosition" ADD COLUMN "externalKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ManagedPosition_externalKey_key" ON "ManagedPosition"("externalKey");
