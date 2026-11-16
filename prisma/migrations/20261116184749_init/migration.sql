-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'MANAGER', 'TECHNICIAN', 'CLIENT', 'REQUESTER');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('NEW', 'ASSESSING', 'ASSESSED', 'QUOTING', 'AWAITING_APPROVAL', 'APPROVED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'AWAITING_VERIFICATION', 'VERIFIED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "QuoteKind" AS ENUM ('ORIGINAL', 'VARIATION');

-- CreateEnum
CREATE TYPE "LineKind" AS ENUM ('LABOUR', 'MATERIAL', 'OTHER');

-- CreateEnum
CREATE TYPE "LinkPurpose" AS ENUM ('QUOTE', 'COMPLETION');

-- CreateEnum
CREATE TYPE "DecisionOutcome" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DecisionVia" AS ENUM ('LINK', 'PORTAL', 'IN_PERSON', 'INTERNAL');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('REQUEST', 'ASSESSMENT', 'QUOTE', 'PROGRESS', 'BEFORE', 'AFTER', 'TEST_DOCUMENT', 'SIGNATURE', 'LOGO');

-- CreateEnum
CREATE TYPE "UpdateKind" AS ENUM ('PROGRESS', 'NOTE', 'CLARIFICATION', 'ADDITIONAL_WORK');

-- CreateEnum
CREATE TYPE "CompletionStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "activeOrgId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organisation" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "brandColour" TEXT NOT NULL DEFAULT '#0f4c81',
    "logoAttachmentId" UUID,
    "address" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "contactEmail" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatNumber" TEXT NOT NULL DEFAULT '',
    "vatRateBps" INTEGER NOT NULL DEFAULT 1500,
    "quoteTerms" TEXT NOT NULL DEFAULT '',
    "quoteValidityDays" INTEGER NOT NULL DEFAULT 30,
    "customerSignoffRequired" BOOLEAN NOT NULL DEFAULT true,
    "jobSeq" INTEGER NOT NULL DEFAULT 0,
    "quoteSeq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roles" "Role"[],
    "clientId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "roles" "Role"[],
    "clientId" UUID,
    "tokenHash" TEXT NOT NULL,
    "invitedBy" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriorityRule" (
    "orgId" UUID NOT NULL,
    "priority" "Priority" NOT NULL,
    "responseHours" INTEGER NOT NULL,
    "completionHours" INTEGER NOT NULL,

    CONSTRAINT "PriorityRule_pkey" PRIMARY KEY ("orgId","priority")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "locationId" UUID,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "serialNumber" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "status" "JobStatus" NOT NULL DEFAULT 'NEW',
    "heldFromStatus" "JobStatus",
    "holdReason" TEXT,
    "cancelReason" TEXT,
    "directAuthReason" TEXT,
    "clientId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "locationId" UUID,
    "assetId" UUID,
    "requesterId" UUID NOT NULL,
    "ownerId" UUID,
    "leadTechnicianId" UUID,
    "externalContractor" TEXT,
    "instructions" TEXT,
    "plannedStart" TIMESTAMP(3),
    "plannedEnd" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "customerSignoffRequired" BOOLEAN NOT NULL DEFAULT true,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobTechnician" (
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "JobTechnician_pkey" PRIMARY KEY ("jobId","userId")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "findings" TEXT NOT NULL,
    "suspectedCause" TEXT NOT NULL DEFAULT '',
    "recommendedWork" TEXT NOT NULL DEFAULT '',
    "materials" TEXT NOT NULL DEFAULT '',
    "labourHoursEstimate" DECIMAL(8,2),
    "quoteRequired" BOOLEAN NOT NULL,
    "externalHelpRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "kind" "QuoteKind" NOT NULL DEFAULT 'ORIGINAL',
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" TEXT NOT NULL DEFAULT '',
    "terms" TEXT NOT NULL DEFAULT '',
    "validUntil" TIMESTAMP(3),
    "vatRateBps" INTEGER NOT NULL DEFAULT 0,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "LineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "lineTotalCents" INTEGER NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Completion" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "CompletionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "workPerformed" TEXT NOT NULL,
    "observations" TEXT NOT NULL DEFAULT '',
    "completedAt" TIMESTAMP(3) NOT NULL,
    "submittedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Completion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalLink" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "purpose" "LinkPurpose" NOT NULL,
    "quoteId" UUID,
    "completionId" UUID,
    "tokenHash" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "quoteId" UUID,
    "completionId" UUID,
    "outcome" "DecisionOutcome" NOT NULL,
    "via" "DecisionVia" NOT NULL,
    "deciderUserId" UUID,
    "deciderName" TEXT NOT NULL,
    "deciderEmail" TEXT NOT NULL DEFAULT '',
    "recordedById" UUID,
    "linkId" UUID,
    "comment" TEXT NOT NULL DEFAULT '',
    "signatureAttachmentId" UUID,
    "ipAddress" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkUpdate" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "kind" "UpdateKind" NOT NULL DEFAULT 'PROGRESS',
    "note" TEXT NOT NULL,
    "labourMinutes" INTEGER NOT NULL DEFAULT 0,
    "materialDescription" TEXT NOT NULL DEFAULT '',
    "materialCostCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "jobId" UUID,
    "quoteId" UUID,
    "completionId" UUID,
    "kind" "AttachmentKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "jobId" UUID,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "actorUserId" UUID,
    "actorLabel" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "jobId" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEmail" (
    "id" UUID NOT NULL,
    "orgId" UUID,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxUsers" INTEGER,
    "maxActiveJobs" INTEGER,
    "maxClients" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "graceEndsAt" TIMESTAMP(3),
    "providerRef" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportAccessGrant" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "grantedById" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_orgId_userId_key" ON "Membership"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_orgId_idx" ON "Invitation"("orgId");

-- CreateIndex
CREATE INDEX "Client_orgId_name_idx" ON "Client"("orgId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Client_orgId_id_key" ON "Client"("orgId", "id");

-- CreateIndex
CREATE INDEX "Site_orgId_clientId_idx" ON "Site"("orgId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_orgId_id_key" ON "Site"("orgId", "id");

-- CreateIndex
CREATE INDEX "Location_orgId_siteId_idx" ON "Location"("orgId", "siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_orgId_id_key" ON "Location"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_orgId_id_key" ON "Asset"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_orgId_reference_key" ON "Asset"("orgId", "reference");

-- CreateIndex
CREATE INDEX "Job_orgId_status_idx" ON "Job"("orgId", "status");

-- CreateIndex
CREATE INDEX "Job_orgId_clientId_idx" ON "Job"("orgId", "clientId");

-- CreateIndex
CREATE INDEX "Job_orgId_leadTechnicianId_idx" ON "Job"("orgId", "leadTechnicianId");

-- CreateIndex
CREATE UNIQUE INDEX "Job_orgId_id_key" ON "Job"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Job_orgId_reference_key" ON "Job"("orgId", "reference");

-- CreateIndex
CREATE INDEX "JobTechnician_orgId_userId_idx" ON "JobTechnician"("orgId", "userId");

-- CreateIndex
CREATE INDEX "Assessment_orgId_jobId_idx" ON "Assessment"("orgId", "jobId");

-- CreateIndex
CREATE INDEX "Quote_orgId_jobId_idx" ON "Quote"("orgId", "jobId");

-- CreateIndex
CREATE INDEX "Quote_orgId_status_idx" ON "Quote"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_orgId_id_key" ON "Quote"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_orgId_number_version_key" ON "Quote"("orgId", "number", "version");

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Completion_orgId_id_key" ON "Completion"("orgId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Completion_jobId_version_key" ON "Completion"("jobId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalLink_tokenHash_key" ON "ApprovalLink"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_quoteId_key" ON "Decision"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_completionId_key" ON "Decision"("completionId");

-- CreateIndex
CREATE INDEX "Decision_orgId_jobId_idx" ON "Decision"("orgId", "jobId");

-- CreateIndex
CREATE INDEX "WorkUpdate_orgId_jobId_idx" ON "WorkUpdate"("orgId", "jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_orgId_jobId_idx" ON "Attachment"("orgId", "jobId");

-- CreateIndex
CREATE INDEX "ActivityEvent_orgId_jobId_createdAt_idx" ON "ActivityEvent"("orgId", "jobId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_orgId_createdAt_idx" ON "ActivityEvent"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_orgId_readAt_idx" ON "Notification"("userId", "orgId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEmail_dedupeKey_key" ON "OutboxEmail"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxEmail_status_nextAttemptAt_idx" ON "OutboxEmail"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_orgId_key" ON "Subscription"("orgId");

-- CreateIndex
CREATE INDEX "SupportAccessGrant_orgId_idx" ON "SupportAccessGrant"("orgId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_orgId_clientId_fkey" FOREIGN KEY ("orgId", "clientId") REFERENCES "Client"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriorityRule" ADD CONSTRAINT "PriorityRule_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_orgId_clientId_fkey" FOREIGN KEY ("orgId", "clientId") REFERENCES "Client"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_orgId_siteId_fkey" FOREIGN KEY ("orgId", "siteId") REFERENCES "Site"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_orgId_siteId_fkey" FOREIGN KEY ("orgId", "siteId") REFERENCES "Site"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_orgId_locationId_fkey" FOREIGN KEY ("orgId", "locationId") REFERENCES "Location"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_orgId_clientId_fkey" FOREIGN KEY ("orgId", "clientId") REFERENCES "Client"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_orgId_siteId_fkey" FOREIGN KEY ("orgId", "siteId") REFERENCES "Site"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_orgId_locationId_fkey" FOREIGN KEY ("orgId", "locationId") REFERENCES "Location"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_orgId_assetId_fkey" FOREIGN KEY ("orgId", "assetId") REFERENCES "Asset"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobTechnician" ADD CONSTRAINT "JobTechnician_orgId_jobId_fkey" FOREIGN KEY ("orgId", "jobId") REFERENCES "Job"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assessment" ADD CONSTRAINT "Assessment_orgId_jobId_fkey" FOREIGN KEY ("orgId", "jobId") REFERENCES "Job"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_orgId_jobId_fkey" FOREIGN KEY ("orgId", "jobId") REFERENCES "Job"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_orgId_quoteId_fkey" FOREIGN KEY ("orgId", "quoteId") REFERENCES "Quote"("orgId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Completion" ADD CONSTRAINT "Completion_orgId_jobId_fkey" FOREIGN KEY ("orgId", "jobId") REFERENCES "Job"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLink" ADD CONSTRAINT "ApprovalLink_orgId_quoteId_fkey" FOREIGN KEY ("orgId", "quoteId") REFERENCES "Quote"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalLink" ADD CONSTRAINT "ApprovalLink_orgId_completionId_fkey" FOREIGN KEY ("orgId", "completionId") REFERENCES "Completion"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "Completion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkUpdate" ADD CONSTRAINT "WorkUpdate_orgId_jobId_fkey" FOREIGN KEY ("orgId", "jobId") REFERENCES "Job"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_orgId_jobId_fkey" FOREIGN KEY ("orgId", "jobId") REFERENCES "Job"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_orgId_jobId_fkey" FOREIGN KEY ("orgId", "jobId") REFERENCES "Job"("orgId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
