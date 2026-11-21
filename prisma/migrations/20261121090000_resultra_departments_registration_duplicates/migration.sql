-- Resultra upgrade: departments and handovers, site registration codes with approval, short public QR codes,
-- duplicate / repeat-fault links, double-submit guard, demo personas, platform error log.
-- Additive only: new tables and nullable / defaulted columns. Rollback = redeploy the previous release; nothing is dropped.

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('NONE', 'FLAGGED', 'LINKED', 'DISMISSED');

-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "publicCode" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "departmentId" UUID,
ADD COLUMN     "duplicateOfId" UUID,
ADD COLUMN     "duplicateStatus" "DuplicateStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "possibleDuplicateIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "repeatOfId" UUID,
ADD COLUMN     "submissionKey" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "publicCode" TEXT;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "joinCodeId" UUID,
ADD COLUMN     "requestedDepartmentId" UUID,
ADD COLUMN     "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "actAsUserId" UUID;

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "publicCode" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "demoPersona" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jobTitle" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "phone" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "photoKey" TEXT;

-- CreateTable
CREATE TABLE "Department" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepartmentMember" (
    "orgId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "isManager" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DepartmentMember_pkey" PRIMARY KEY ("departmentId","userId")
);

-- CreateTable
CREATE TABLE "JobHandover" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "fromDepartmentId" UUID,
    "toDepartmentId" UUID,
    "fromUserId" UUID,
    "toUserId" UUID,
    "byUserId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobHandover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JoinCode" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "siteId" UUID,
    "code" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JoinCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT '',
    "orgId" UUID,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_orgId_id_key" ON "Department"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Department_orgId_name_key" ON "Department"("orgId", "name");

-- CreateIndex
CREATE INDEX "DepartmentMember_orgId_userId_idx" ON "DepartmentMember"("orgId", "userId");

-- CreateIndex
CREATE INDEX "JobHandover_orgId_jobId_idx" ON "JobHandover"("orgId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "JoinCode_code_key" ON "JoinCode"("code");

-- CreateIndex
CREATE INDEX "JoinCode_orgId_idx" ON "JoinCode"("orgId");

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_publicCode_key" ON "Asset"("publicCode");

-- CreateIndex
CREATE INDEX "Job_orgId_departmentId_idx" ON "Job"("orgId", "departmentId");

-- CreateIndex
CREATE INDEX "Job_orgId_duplicateStatus_idx" ON "Job"("orgId", "duplicateStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Job_orgId_submissionKey_key" ON "Job"("orgId", "submissionKey");

-- CreateIndex
CREATE UNIQUE INDEX "Location_publicCode_key" ON "Location"("publicCode");

-- CreateIndex
CREATE UNIQUE INDEX "Site_publicCode_key" ON "Site"("publicCode");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_orgId_departmentId_fkey" FOREIGN KEY ("orgId", "departmentId") REFERENCES "Department"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepartmentMember" ADD CONSTRAINT "DepartmentMember_orgId_departmentId_fkey" FOREIGN KEY ("orgId", "departmentId") REFERENCES "Department"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobHandover" ADD CONSTRAINT "JobHandover_orgId_jobId_fkey" FOREIGN KEY ("orgId", "jobId") REFERENCES "Job"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Short public codes for existing sites, areas and machines (10 random hex characters; new rows get
-- 10 random base-32 characters from the app). Old /r/{publicToken} links keep working.
UPDATE "Site" SET "publicCode" = substr(md5(random()::text || "id"::text || clock_timestamp()::text), 1, 10) WHERE "publicCode" IS NULL;
UPDATE "Location" SET "publicCode" = substr(md5(random()::text || "id"::text || clock_timestamp()::text), 1, 10) WHERE "publicCode" IS NULL;
UPDATE "Asset" SET "publicCode" = substr(md5(random()::text || "id"::text || clock_timestamp()::text), 1, 10) WHERE "publicCode" IS NULL;

-- Handovers are part of the audit trail: they cannot be changed or deleted.
CREATE TRIGGER handover_append_only BEFORE UPDATE OR DELETE ON "JobHandover"
  FOR EACH ROW EXECUTE FUNCTION fr_append_only();
