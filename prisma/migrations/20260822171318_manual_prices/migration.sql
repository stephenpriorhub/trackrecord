-- AlterTable
ALTER TABLE "ManagedPosition" ADD COLUMN     "cachedManualPriced" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MarketInstrument" ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "manualPrice" DECIMAL(18,6),
ADD COLUMN     "manualPriceAt" TIMESTAMP(3),
ADD COLUMN     "manualPriceBy" TEXT;
