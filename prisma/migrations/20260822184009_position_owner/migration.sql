-- AlterTable
ALTER TABLE "ManagedPosition" ADD COLUMN     "guruId" TEXT;

-- AddForeignKey
ALTER TABLE "ManagedPosition" ADD CONSTRAINT "ManagedPosition_guruId_fkey" FOREIGN KEY ("guruId") REFERENCES "Guru"("id") ON DELETE SET NULL ON UPDATE CASCADE;
