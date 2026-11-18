-- Maintenance work requisition: signatures per line, root cause, tools/clean-area check, projects, numbering.
-- CreateEnum
CREATE TYPE "RootCause" AS ENUM ('MAINTENANCE', 'AGE_OF_MACHINE', 'OPERATOR', 'HUMAN_ERROR', 'WEAR_AND_TEAR', 'BREAKDOWN', 'CHANGE_OVER', 'OTHER');

-- CreateEnum
CREATE TYPE "SignatureStep" AS ENUM ('REPORTED', 'RECEIVED', 'APPROVAL', 'COMPLETED', 'ORIGINATOR', 'MANAGER');

-- AlterTable
ALTER TABLE "Completion" ADD COLUMN     "rootCauseNotes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "rootCauses" "RootCause"[],
ADD COLUMN     "toolsAndAreaOk" BOOLEAN;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "isProject" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "foodArea" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "referencePrefix" TEXT NOT NULL DEFAULT 'REQ-',
ADD COLUMN     "requireSignatures" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "JobSignature" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "step" "SignatureStep" NOT NULL,
    "name" TEXT NOT NULL,
    "userId" UUID,
    "attachmentId" UUID NOT NULL,
    "quoteId" UUID,
    "completionId" UUID,
    "ip" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobSignature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobSignature_orgId_jobId_idx" ON "JobSignature"("orgId", "jobId");

-- AddForeignKey
ALTER TABLE "JobSignature" ADD CONSTRAINT "JobSignature_orgId_jobId_fkey" FOREIGN KEY ("orgId", "jobId") REFERENCES "Job"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: signatures on the requisition are evidence and can never be changed or removed.
CREATE TRIGGER jobsignature_append_only BEFORE UPDATE OR DELETE ON "JobSignature"
  FOR EACH ROW EXECUTE FUNCTION fr_append_only();
ALTER TABLE "Organisation" ADD CONSTRAINT org_reference_prefix CHECK (char_length("referencePrefix") <= 10);
ALTER TABLE "JobSignature" ADD CONSTRAINT jobsignature_name CHECK (char_length(btrim("name")) >= 2);
