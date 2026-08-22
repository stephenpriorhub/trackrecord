-- AlterTable
ALTER TABLE "ManagedPortfolio" ADD COLUMN     "showBenchmark" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "BenchmarkClose" (
    "ticker" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "close" DECIMAL(18,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BenchmarkClose_pkey" PRIMARY KEY ("ticker","date")
);

-- CreateIndex
CREATE INDEX "BenchmarkClose_ticker_date_idx" ON "BenchmarkClose"("ticker", "date");
