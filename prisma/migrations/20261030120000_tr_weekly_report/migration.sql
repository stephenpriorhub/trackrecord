-- CreateTable
CREATE TABLE "TrWeeklyReport" (
    "id" TEXT NOT NULL,
    "weekEnding" DATE NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedBy" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "editedBy" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentBy" TEXT,
    "sentTo" JSONB,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrWeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrReportSettings" (
    "id" TEXT NOT NULL,
    "to" TEXT[],
    "cc" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "TrReportSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrWeeklyReport_weekEnding_key" ON "TrWeeklyReport"("weekEnding");
