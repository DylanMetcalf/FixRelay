-- Spares and parts per job (set at assessment, moved on by stores) and the Stores role.
-- CreateEnum
CREATE TYPE "SparesStatus" AS ENUM ('NOT_NEEDED', 'ON_HAND', 'TO_BUY', 'ORDERED', 'READY');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'STORES';

-- AlterTable
ALTER TABLE "Assessment" ADD COLUMN     "sparesList" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sparesNeeded" "SparesStatus" NOT NULL DEFAULT 'NOT_NEEDED';

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "sparesEta" TIMESTAMP(3),
ADD COLUMN     "sparesList" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sparesNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sparesStatus" "SparesStatus" NOT NULL DEFAULT 'NOT_NEEDED';


-- Hand-written: stores look jobs up by spares status.
CREATE INDEX "Job_orgId_sparesStatus_idx" ON "Job"("orgId", "sparesStatus");
