-- AlterEnum
ALTER TYPE "PriceSource" ADD VALUE 'NAV';

-- AlterTable
ALTER TABLE "MarketInstrument" ADD COLUMN     "navAssetClass" TEXT;
