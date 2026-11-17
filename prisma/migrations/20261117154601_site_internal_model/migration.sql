-- Pivot to the internal site model (see WORKFLOWS.md). Hand-edited: renames instead of drop/add where data
-- carries over; customer-side users become requesters BEFORE the CLIENT role is removed.
ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS membership_client_scope;
UPDATE "Membership" SET roles = array_replace(roles, 'CLIENT'::"Role", 'REQUESTER'::"Role") WHERE 'CLIENT' = ANY(roles);
UPDATE "Invitation" SET roles = array_replace(roles, 'CLIENT'::"Role", 'REQUESTER'::"Role") WHERE 'CLIENT' = ANY(roles);
-- Several contractors can quote on the same job at the same time.
DROP INDEX IF EXISTS quote_one_submitted_original;

-- CreateEnum
CREATE TYPE "JobRoute" AS ENUM ('UNDECIDED', 'IN_HOUSE', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "JobSource" AS ENUM ('APP', 'PUBLIC_LINK');

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('OWNER', 'MANAGER', 'APPROVER', 'TECHNICIAN', 'REQUESTER');
ALTER TABLE "Membership" ALTER COLUMN "roles" TYPE "Role_new"[] USING ("roles"::text::"Role_new"[]);
ALTER TABLE "Invitation" ALTER COLUMN "roles" TYPE "Role_new"[] USING ("roles"::text::"Role_new"[]);
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ApprovalLink" DROP CONSTRAINT "ApprovalLink_orgId_completionId_fkey";

-- DropForeignKey
ALTER TABLE "ApprovalLink" DROP CONSTRAINT "ApprovalLink_orgId_quoteId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_orgId_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Membership" DROP CONSTRAINT "Membership_orgId_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Site" DROP CONSTRAINT "Site_orgId_clientId_fkey";

-- DropIndex
DROP INDEX "Job_orgId_clientId_idx";

-- DropIndex
DROP INDEX "Site_orgId_clientId_idx";

-- AlterTable
ALTER TABLE "Completion" ADD COLUMN     "contractorId" UUID,
ALTER COLUMN "submittedById" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Invitation" DROP COLUMN "clientId",
ADD COLUMN     "siteIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Job" RENAME COLUMN "customerSignoffRequired" TO "reporterConfirmation";
ALTER TABLE "Job" DROP COLUMN "clientId",
DROP COLUMN "externalContractor",
ADD COLUMN     "approvedCostCents" INTEGER,
ADD COLUMN     "contractorId" UUID,
ADD COLUMN     "poNumber" TEXT,
ADD COLUMN     "quoteDeadline" TIMESTAMP(3),
ADD COLUMN     "quoteExceptionReason" TEXT,
ADD COLUMN     "recommendedQuoteId" UUID,
ADD COLUMN     "reporterEmail" TEXT,
ADD COLUMN     "reporterName" TEXT,
ADD COLUMN     "reporterPhone" TEXT,
ADD COLUMN     "route" "JobRoute" NOT NULL DEFAULT 'UNDECIDED',
ADD COLUMN     "source" "JobSource" NOT NULL DEFAULT 'APP',
ALTER COLUMN "requesterId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Membership" DROP COLUMN "clientId",
ADD COLUMN     "siteIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Organisation" RENAME COLUMN "customerSignoffRequired" TO "reporterConfirmation";
ALTER TABLE "Organisation" DROP COLUMN "quoteTerms",
DROP COLUMN "quoteValidityDays",
DROP COLUMN "vatNumber",
DROP COLUMN "vatRateBps",
DROP COLUMN "vatRegistered",
ADD COLUMN     "approverApprovalLimitCents" INTEGER DEFAULT 5000000,
ADD COLUMN     "managerApprovalLimitCents" INTEGER NOT NULL DEFAULT 500000,
ADD COLUMN     "minQuotes" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "multiQuoteThresholdCents" INTEGER NOT NULL DEFAULT 1000000,
ADD COLUMN     "poRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicReportingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Plan" RENAME COLUMN "maxClients" TO "maxSites";

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "contractorId" UUID,
ADD COLUMN     "leadTimeDays" INTEGER,
ADD COLUMN     "viaLink" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Site" DROP COLUMN "clientId",
ADD COLUMN     "archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicToken" TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '');
ALTER TABLE "Site" ALTER COLUMN "publicToken" DROP DEFAULT;

-- DropTable
DROP TABLE "ApprovalLink";

-- DropTable
DROP TABLE "Client";

-- CreateTable
CREATE TABLE "ContractorLink" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "contractorId" UUID NOT NULL,
    "purpose" "LinkPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractorLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contractor" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trade" TEXT NOT NULL DEFAULT '',
    "contactName" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatNumber" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractorLink_tokenHash_key" ON "ContractorLink"("tokenHash");

-- CreateIndex
CREATE INDEX "ContractorLink_orgId_jobId_idx" ON "ContractorLink"("orgId", "jobId");

-- CreateIndex
CREATE INDEX "Contractor_orgId_name_idx" ON "Contractor"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Contractor_orgId_id_key" ON "Contractor"("orgId", "id");

-- CreateIndex
CREATE INDEX "Job_orgId_siteId_idx" ON "Job"("orgId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_publicToken_key" ON "Site"("publicToken");

-- CreateIndex
CREATE INDEX "Site_orgId_name_idx" ON "Site"("orgId", "name");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_orgId_contractorId_fkey" FOREIGN KEY ("orgId", "contractorId") REFERENCES "Contractor"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_orgId_contractorId_fkey" FOREIGN KEY ("orgId", "contractorId") REFERENCES "Contractor"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorLink" ADD CONSTRAINT "ContractorLink_orgId_jobId_fkey" FOREIGN KEY ("orgId", "jobId") REFERENCES "Job"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorLink" ADD CONSTRAINT "ContractorLink_orgId_contractorId_fkey" FOREIGN KEY ("orgId", "contractorId") REFERENCES "Contractor"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---- Integrity rules for the new model ----
ALTER TABLE "Organisation" ADD CONSTRAINT org_approval_rules CHECK (
  "managerApprovalLimitCents" >= 0 AND ("approverApprovalLimitCents" IS NULL OR "approverApprovalLimitCents" >= 0)
  AND "multiQuoteThresholdCents" >= 0 AND "minQuotes" BETWEEN 1 AND 10);
ALTER TABLE "Job" ADD CONSTRAINT job_contractor_route CHECK ("contractorId" IS NULL OR route = 'CONTRACTOR');
ALTER TABLE "Job" ADD CONSTRAINT job_reporter CHECK (
  "requesterId" IS NOT NULL OR (source = 'PUBLIC_LINK' AND "reporterName" IS NOT NULL));
ALTER TABLE "Job" ADD CONSTRAINT job_approved_cost CHECK ("approvedCostCents" IS NULL OR "approvedCostCents" >= 0);
ALTER TABLE "Quote" ADD CONSTRAINT quote_lead_time CHECK ("leadTimeDays" IS NULL OR "leadTimeDays" BETWEEN 0 AND 3650);

-- Quotes stay frozen once submitted; the contractor is now part of the frozen content.
CREATE OR REPLACE FUNCTION fr_quote_frozen() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'submitted quotes cannot be deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'DRAFT' AND (
       NEW.scope IS DISTINCT FROM OLD.scope OR NEW.terms IS DISTINCT FROM OLD.terms
    OR NEW."validUntil" IS DISTINCT FROM OLD."validUntil" OR NEW."vatRateBps" <> OLD."vatRateBps"
    OR NEW."subtotalCents" <> OLD."subtotalCents" OR NEW."vatCents" <> OLD."vatCents"
    OR NEW."totalCents" <> OLD."totalCents" OR NEW.number <> OLD.number OR NEW.version <> OLD.version
    OR NEW."jobId" <> OLD."jobId" OR NEW."orgId" <> OLD."orgId" OR NEW.kind <> OLD.kind
    OR NEW."contractorId" IS DISTINCT FROM OLD."contractorId" OR NEW."leadTimeDays" IS DISTINCT FROM OLD."leadTimeDays") THEN
    RAISE EXCEPTION 'quote % v% is frozen', OLD.number, OLD.version USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
