-- CreateEnum
CREATE TYPE "InstrumentKind" AS ENUM ('STOCK', 'OPTION');

-- CreateEnum
CREATE TYPE "OptionRight" AS ENUM ('CALL', 'PUT');

-- CreateEnum
CREATE TYPE "LegSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "FillIntent" AS ENUM ('OPEN', 'CLOSE');

-- CreateEnum
CREATE TYPE "FillSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "ManagedStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ManagedSource" AS ENUM ('MANUAL', 'AIRTABLE_IMPORT');

-- CreateEnum
CREATE TYPE "PortfolioVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "StructureKind" AS ENUM ('LONG_STOCK', 'LONG_CALL', 'LONG_PUT', 'VERTICAL_DEBIT', 'VERTICAL_CREDIT', 'STRADDLE', 'STRANGLE', 'BUTTERFLY', 'IRON_CONDOR', 'IRON_BUTTERFLY', 'CUSTOM_DEFINED_RISK', 'UNDEFINED_RISK');

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('LAST_TRADE', 'PREV_CLOSE', 'MANUAL', 'NONE');

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "pubCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceGuru" (
    "serviceId" TEXT NOT NULL,
    "guruId" TEXT NOT NULL,

    CONSTRAINT "ServiceGuru_pkey" PRIMARY KEY ("serviceId","guruId")
);

-- CreateTable
CREATE TABLE "ManagedPortfolio" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "visibility" "PortfolioVisibility" NOT NULL DEFAULT 'PRIVATE',
    "archivedAt" TIMESTAMP(3),
    "benchmarkTicker" TEXT NOT NULL DEFAULT 'SPY',
    "airtableTradeGroupId" TEXT,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedPortfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedPosition" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "underlying" TEXT NOT NULL,
    "companyName" TEXT,
    "instrument" "InstrumentKind" NOT NULL,
    "structure" "StructureKind" NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ManagedStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "buyUpToPrice" DECIMAL(18,6),
    "stopLossPrice" DECIMAL(18,6),
    "targetPrice" DECIMAL(18,6),
    "thesis" TEXT,
    "cachedEntryPrice" DECIMAL(18,6),
    "cachedCurrentPrice" DECIMAL(18,6),
    "cachedReturnPct" DECIMAL(12,8),
    "cachedRealizedPnl" DECIMAL(18,6),
    "cachedUnrealizedPnl" DECIMAL(18,6),
    "cachedUnpriced" BOOLEAN NOT NULL DEFAULT false,
    "cachedAt" TIMESTAMP(3),
    "source" "ManagedSource" NOT NULL DEFAULT 'MANUAL',
    "airtableId" TEXT,
    "createdByEmail" TEXT,
    "updatedByEmail" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedLeg" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "legIndex" INTEGER NOT NULL,
    "kind" "InstrumentKind" NOT NULL,
    "underlying" TEXT NOT NULL,
    "marketTicker" TEXT NOT NULL,
    "expiry" DATE,
    "strike" DECIMAL(18,6),
    "right" "OptionRight",
    "side" "LegSide" NOT NULL,
    "ratio" INTEGER NOT NULL DEFAULT 1,
    "multiplier" INTEGER NOT NULL,
    "openQty" INTEGER NOT NULL DEFAULT 0,
    "closedQty" INTEGER NOT NULL DEFAULT 0,
    "wavgEntry" DECIMAL(18,6),
    "wavgExit" DECIMAL(18,6),
    "realizedPnl" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedExecution" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "intent" "FillIntent" NOT NULL,
    "units" INTEGER,
    "leggedOut" BOOLEAN NOT NULL DEFAULT false,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdByEmail" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedFill" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "legId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "intent" "FillIntent" NOT NULL,
    "side" "FillSide" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "multiplier" INTEGER NOT NULL,
    "cashFlow" DECIMAL(18,6) NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedFill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedComment" (
    "id" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "legId" TEXT,
    "executionId" TEXT,
    "body" TEXT NOT NULL,
    "authorEmail" TEXT,
    "authorName" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketInstrument" (
    "ticker" TEXT NOT NULL,
    "kind" "InstrumentKind" NOT NULL,
    "underlying" TEXT NOT NULL,
    "expiry" DATE,
    "strike" DECIMAL(18,6),
    "right" "OptionRight",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastPrice" DECIMAL(18,6),
    "lastPriceAt" TIMESTAMP(3),
    "priceSource" "PriceSource" NOT NULL DEFAULT 'NONE',
    "prevClose" DECIMAL(18,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketInstrument_pkey" PRIMARY KEY ("ticker")
);

-- CreateTable
CREATE TABLE "AppManager" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppManager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioAssignment" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "serviceId" TEXT,
    "portfolioId" TEXT,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "portfolioId" TEXT,
    "actorEmail" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "before" JSONB,
    "after" JSONB,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Service_pubCode_key" ON "Service"("pubCode");

-- CreateIndex
CREATE UNIQUE INDEX "Service_slug_key" ON "Service"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedPortfolio_slug_key" ON "ManagedPortfolio"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedPortfolio_airtableTradeGroupId_key" ON "ManagedPortfolio"("airtableTradeGroupId");

-- CreateIndex
CREATE INDEX "ManagedPortfolio_serviceId_sortOrder_idx" ON "ManagedPortfolio"("serviceId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedPortfolio_serviceId_name_key" ON "ManagedPortfolio"("serviceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedPosition_airtableId_key" ON "ManagedPosition"("airtableId");

-- CreateIndex
CREATE INDEX "ManagedPosition_portfolioId_status_openedAt_idx" ON "ManagedPosition"("portfolioId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "ManagedPosition_underlying_idx" ON "ManagedPosition"("underlying");

-- CreateIndex
CREATE INDEX "ManagedPosition_deletedAt_idx" ON "ManagedPosition"("deletedAt");

-- CreateIndex
CREATE INDEX "ManagedLeg_marketTicker_idx" ON "ManagedLeg"("marketTicker");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedLeg_positionId_legIndex_key" ON "ManagedLeg"("positionId", "legIndex");

-- CreateIndex
CREATE INDEX "ManagedExecution_positionId_executedAt_idx" ON "ManagedExecution"("positionId", "executedAt");

-- CreateIndex
CREATE INDEX "ManagedExecution_deletedAt_idx" ON "ManagedExecution"("deletedAt");

-- CreateIndex
CREATE INDEX "ManagedFill_legId_executedAt_createdAt_idx" ON "ManagedFill"("legId", "executedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ManagedFill_positionId_idx" ON "ManagedFill"("positionId");

-- CreateIndex
CREATE INDEX "ManagedFill_deletedAt_idx" ON "ManagedFill"("deletedAt");

-- CreateIndex
CREATE INDEX "ManagedComment_positionId_createdAt_idx" ON "ManagedComment"("positionId", "createdAt");

-- CreateIndex
CREATE INDEX "ManagedComment_legId_idx" ON "ManagedComment"("legId");

-- CreateIndex
CREATE INDEX "ManagedComment_deletedAt_idx" ON "ManagedComment"("deletedAt");

-- CreateIndex
CREATE INDEX "MarketInstrument_active_idx" ON "MarketInstrument"("active");

-- CreateIndex
CREATE INDEX "MarketInstrument_underlying_idx" ON "MarketInstrument"("underlying");

-- CreateIndex
CREATE UNIQUE INDEX "AppManager_email_key" ON "AppManager"("email");

-- CreateIndex
CREATE INDEX "PortfolioAssignment_email_idx" ON "PortfolioAssignment"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioAssignment_email_serviceId_key" ON "PortfolioAssignment"("email", "serviceId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioAssignment_email_portfolioId_key" ON "PortfolioAssignment"("email", "portfolioId");

-- CreateIndex
CREATE INDEX "ChangeLog_portfolioId_createdAt_idx" ON "ChangeLog"("portfolioId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ChangeLog_entity_entityId_idx" ON "ChangeLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "ChangeLog_createdAt_idx" ON "ChangeLog"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ServiceGuru" ADD CONSTRAINT "ServiceGuru_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceGuru" ADD CONSTRAINT "ServiceGuru_guruId_fkey" FOREIGN KEY ("guruId") REFERENCES "Guru"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedPortfolio" ADD CONSTRAINT "ManagedPortfolio_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedPosition" ADD CONSTRAINT "ManagedPosition_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "ManagedPortfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedLeg" ADD CONSTRAINT "ManagedLeg_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "ManagedPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedLeg" ADD CONSTRAINT "ManagedLeg_marketTicker_fkey" FOREIGN KEY ("marketTicker") REFERENCES "MarketInstrument"("ticker") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedExecution" ADD CONSTRAINT "ManagedExecution_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "ManagedPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedFill" ADD CONSTRAINT "ManagedFill_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ManagedExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedFill" ADD CONSTRAINT "ManagedFill_legId_fkey" FOREIGN KEY ("legId") REFERENCES "ManagedLeg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedFill" ADD CONSTRAINT "ManagedFill_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "ManagedPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedComment" ADD CONSTRAINT "ManagedComment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "ManagedPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedComment" ADD CONSTRAINT "ManagedComment_legId_fkey" FOREIGN KEY ("legId") REFERENCES "ManagedLeg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedComment" ADD CONSTRAINT "ManagedComment_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "ManagedExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioAssignment" ADD CONSTRAINT "PortfolioAssignment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioAssignment" ADD CONSTRAINT "PortfolioAssignment_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "ManagedPortfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "ManagedPortfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
