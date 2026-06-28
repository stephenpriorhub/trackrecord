CREATE TABLE "PositionGuru" (
    "positionId" TEXT NOT NULL,
    "guruId" TEXT NOT NULL,
    CONSTRAINT "PositionGuru_pkey" PRIMARY KEY ("positionId","guruId")
);
ALTER TABLE "PositionGuru" ADD CONSTRAINT "PositionGuru_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PositionGuru" ADD CONSTRAINT "PositionGuru_guruId_fkey" FOREIGN KEY ("guruId") REFERENCES "Guru"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
