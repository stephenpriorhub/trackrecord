-- CreateTable
CREATE TABLE "TrService" (
    "code" TEXT NOT NULL,
    "publicToken" TEXT,
    "publicEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicShowBenchmark" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncOk" BOOLEAN,
    "lastSyncMessage" TEXT,
    "lastSyncIssues" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrService_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "TrTrade" (
    "id" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sheetTab" TEXT NOT NULL,
    "sheetRow" INTEGER NOT NULL,
    "portfolio" TEXT NOT NULL,
    "guru" TEXT,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "underlying" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "structure" TEXT NOT NULL,
    "optionType" TEXT,
    "strike" TEXT,
    "expiry" DATE,
    "side" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "openDate" DATE NOT NULL,
    "closeDate" DATE,
    "closeAfterBell" BOOLEAN NOT NULL DEFAULT false,
    "entryPrice" DOUBLE PRECISION,
    "exitPrice" DOUBLE PRECISION,
    "returnPct" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "premiumCapture" DOUBLE PRECISION,
    "holdDays" INTEGER,
    "notes" TEXT,
    "airtableId" TEXT,
    "spxReturnPct" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrService_publicToken_key" ON "TrService"("publicToken");

-- CreateIndex
CREATE UNIQUE INDEX "TrTrade_sourceKey_key" ON "TrTrade"("sourceKey");

-- CreateIndex
CREATE INDEX "TrTrade_serviceCode_closeDate_idx" ON "TrTrade"("serviceCode", "closeDate");

-- CreateIndex
CREATE INDEX "TrTrade_serviceCode_openDate_idx" ON "TrTrade"("serviceCode", "openDate");

-- CreateIndex
CREATE INDEX "TrTrade_underlying_idx" ON "TrTrade"("underlying");
