-- Where a portfolio's positions come from, for the one-way sync and the
-- "open in source" links. All additive and nullable: a portfolio with none of
-- these set is simply hand-maintained, which is the intended end state.
ALTER TABLE "ManagedPortfolio" ADD COLUMN "sourceSheetId" TEXT;
ALTER TABLE "ManagedPortfolio" ADD COLUMN "syncedAt" TIMESTAMP(3);
ALTER TABLE "ManagedPortfolio" ADD COLUMN "syncNote" TEXT;
