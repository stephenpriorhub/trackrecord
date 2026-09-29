-- CreateTable
CREATE TABLE "SavedEmbed" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "query" TEXT NOT NULL DEFAULT '',
    "createdByEmail" TEXT,
    "updatedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SavedEmbed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedEmbed_code_key" ON "SavedEmbed"("code");

-- CreateIndex
CREATE INDEX "SavedEmbed_serviceId_deletedAt_idx" ON "SavedEmbed"("serviceId", "deletedAt");

-- AddForeignKey
ALTER TABLE "SavedEmbed" ADD CONSTRAINT "SavedEmbed_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

