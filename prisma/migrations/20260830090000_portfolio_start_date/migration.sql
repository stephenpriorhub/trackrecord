-- Where a portfolio's benchmark comparison starts.
--
-- Nullable and additive: NULL means "the earliest position open date", which is
-- what every existing portfolio already effectively uses, so no row changes
-- behaviour.
ALTER TABLE "ManagedPortfolio" ADD COLUMN "startDate" DATE;
