-- AlterTable
ALTER TABLE "TrTrade" ADD COLUMN "currentPrice" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "TrAirtableClose" (
    "id" TEXT NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "positionName" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "closeDate" DATE NOT NULL,
    "exitPrice" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "sheetRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrAirtableClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrAirtableClose_tradeId_key" ON "TrAirtableClose"("tradeId");

-- CreateIndex
CREATE INDEX "TrAirtableClose_serviceCode_createdAt_idx" ON "TrAirtableClose"("serviceCode", "createdAt");
