-- Hand-written integrity rules that Prisma's schema language cannot express.

-- Emails are stored lower-case so uniqueness is case-insensitive.
ALTER TABLE "User" ADD CONSTRAINT user_email_lower CHECK (email = lower(email));

-- A CLIENT membership must be scoped to a client organisation.
ALTER TABLE "Membership" ADD CONSTRAINT membership_client_scope
  CHECK (NOT ('CLIENT' = ANY(roles)) OR "clientId" IS NOT NULL);
ALTER TABLE "Membership" ADD CONSTRAINT membership_has_role CHECK (cardinality(roles) > 0);

-- Money and quantity sanity.
ALTER TABLE "QuoteLine" ADD CONSTRAINT quoteline_positive
  CHECK (quantity > 0 AND "unitPriceCents" >= 0 AND "lineTotalCents" >= 0);
ALTER TABLE "Quote" ADD CONSTRAINT quote_totals
  CHECK ("subtotalCents" >= 0 AND "vatCents" >= 0 AND "totalCents" = "subtotalCents" + "vatCents"
         AND "vatRateBps" BETWEEN 0 AND 10000);
ALTER TABLE "WorkUpdate" ADD CONSTRAINT workupdate_nonneg
  CHECK ("labourMinutes" >= 0 AND "materialCostCents" >= 0);

-- Links and decisions point at exactly one subject.
ALTER TABLE "ApprovalLink" ADD CONSTRAINT link_subject CHECK (
  (purpose = 'QUOTE' AND "quoteId" IS NOT NULL AND "completionId" IS NULL) OR
  (purpose = 'COMPLETION' AND "completionId" IS NOT NULL AND "quoteId" IS NULL));
ALTER TABLE "Decision" ADD CONSTRAINT decision_subject CHECK (
  ("quoteId" IS NOT NULL) <> ("completionId" IS NOT NULL));

-- At most one original quote awaiting a decision, one approved original quote,
-- and one completion awaiting verification per job.
CREATE UNIQUE INDEX quote_one_submitted_original ON "Quote" ("jobId") WHERE status = 'SUBMITTED' AND kind = 'ORIGINAL';
CREATE UNIQUE INDEX quote_one_approved_original ON "Quote" ("jobId") WHERE status = 'APPROVED' AND kind = 'ORIGINAL';
CREATE UNIQUE INDEX completion_one_submitted ON "Completion" ("jobId") WHERE status = 'SUBMITTED';

-- Audit trail and decisions are append-only.
CREATE FUNCTION fr_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER activity_append_only BEFORE UPDATE OR DELETE ON "ActivityEvent"
  FOR EACH ROW EXECUTE FUNCTION fr_append_only();
CREATE TRIGGER decision_append_only BEFORE UPDATE OR DELETE ON "Decision"
  FOR EACH ROW EXECUTE FUNCTION fr_append_only();

-- Once a quote leaves DRAFT its commercial content is frozen: only status/decidedAt may change.
CREATE FUNCTION fr_quote_frozen() RETURNS trigger AS $$
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
    OR NEW."jobId" <> OLD."jobId" OR NEW."orgId" <> OLD."orgId" OR NEW.kind <> OLD.kind) THEN
    RAISE EXCEPTION 'quote % v% is frozen', OLD.number, OLD.version USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER quote_frozen BEFORE UPDATE OR DELETE ON "Quote"
  FOR EACH ROW EXECUTE FUNCTION fr_quote_frozen();

CREATE FUNCTION fr_quoteline_frozen() RETURNS trigger AS $$
DECLARE st "QuoteStatus";
BEGIN
  SELECT status INTO st FROM "Quote" WHERE id = COALESCE(NEW."quoteId", OLD."quoteId");
  IF st IS NOT NULL AND st <> 'DRAFT' THEN
    RAISE EXCEPTION 'line items of a submitted quote are frozen' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;
CREATE TRIGGER quoteline_frozen BEFORE INSERT OR UPDATE OR DELETE ON "QuoteLine"
  FOR EACH ROW EXECUTE FUNCTION fr_quoteline_frozen();
