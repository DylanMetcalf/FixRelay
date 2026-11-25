-- ManOp: one-person jobs (Job.mode, company settings) and public sandbox guests. Additive only.
-- CreateEnum
CREATE TYPE "JobMode" AS ENUM ('MANAGED', 'SELF');

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "mode" "JobMode" NOT NULL DEFAULT 'MANAGED';

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "allowSelfJobs" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "selfJobSignOff" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "guestExpiresAt" TIMESTAMP(3);

