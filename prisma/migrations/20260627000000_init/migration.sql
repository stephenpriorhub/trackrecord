-- CreateTable
CREATE TABLE "Guru" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guru_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Portfolio" (
    "id" TEXT NOT NULL,
    "airtableId" TEXT NOT NULL,
    "pubCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessUnit" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortfolioGuru" (
    "portfolioId" TEXT NOT NULL,
    "guruId" TEXT NOT NULL,

    CONSTRAINT "PortfolioGuru_pkey" PRIMARY KEY ("portfolioId","guruId")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "airtableId" TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbols" TEXT[],
    "status" TEXT NOT NULL,
    "investmentType" TEXT NOT NULL,
    "positionReturn" DOUBLE PRECISION,
    "openDate" TIMESTAMP(3),
    "closeDate" TIMESTAMP(3),
    "daysHeld" INTEGER,
    "parentPositionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "airtableId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "name" TEXT,
    "symbol" TEXT,
    "action" TEXT,
    "toOpenOrClose" TEXT,
    "weight" DOUBLE PRECISION,
    "tradePrice" DOUBLE PRECISION,
    "tradeDate" TIMESTAMP(3),
    "investmentType" TEXT,
    "optionType" TEXT,
    "buyingPowerRequired" DOUBLE PRECISION,
    "marginRequirement" DOUBLE PRECISION,
    "latestPrice" DOUBLE PRECISION,
    "tradeReturn" DOUBLE PRECISION,
    "guruId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "portfolioId" TEXT,
    "pubCode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordsSynced" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Guru_slug_key" ON "Guru"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Portfolio_airtableId_key" ON "Portfolio"("airtableId");

-- CreateIndex
CREATE UNIQUE INDEX "Position_airtableId_key" ON "Position"("airtableId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_airtableId_key" ON "Trade"("airtableId");

-- AddForeignKey
ALTER TABLE "PortfolioGuru" ADD CONSTRAINT "PortfolioGuru_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioGuru" ADD CONSTRAINT "PortfolioGuru_guruId_fkey" FOREIGN KEY ("guruId") REFERENCES "Guru"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_parentPositionId_fkey" FOREIGN KEY ("parentPositionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_guruId_fkey" FOREIGN KEY ("guruId") REFERENCES "Guru"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
