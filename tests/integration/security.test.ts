import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hashToken } from "@/lib/tokens";
import { changePassword, loadSession, login, switchWorkspace } from "@/server/auth";
import * as approvals from "@/server/services/approvals";
import { addJobAttachment, readAttachment, readAttachmentViaLink, setOrgLogo } from "@/server/services/attachments";
import { setSubscription } from "@/server/services/billing";
import * as clients from "@/server/services/clients";
import * as jobs from "@/server/services/jobs";
import * as notifications from "@/server/services/notifications";
import * as orgs from "@/server/services/orgs";
import * as quotes from "@/server/services/quotes";
import { getReport } from "@/server/services/reports";
import { code, completedJob, LINES, member, newJob, PNG, quotedJob, startedJob, status, tenant, uniq } from "../helpers";

const NF = code("NOT_FOUND");
const FB = code("FORBIDDEN");
const linkFor = (t: Awaited<ReturnType<typeof tenant>>, target: { quoteId: string } | { completionId: string }) =>
  approvals.createApprovalLink(t.manager, target, { recipientName: "Carl Customer", recipientEmail: "carl@client.example" });

describe("tenant isolation", () => {
  it("a manager of company B cannot read or change anything belonging to company A", async () => {
    const [a, b] = [await tenant(), await tenant()];
    const { job, quote } = await quotedJob(a);
    const att = await addJobAttachment(a.manager, { jobId: job.id, kind: "REQUEST", filename: "x.png", bytes: PNG });
    const evil = b.owner;

    await expect(jobs.getJob(evil, job.id)).rejects.toEqual(NF);
    expect((await jobs.listJobs(evil)).length).toBe(0);
    expect((await clients.listClients(evil)).map((c) => c.id)).not.toContain(a.client.id);
    await expect(clients.getClient(evil, a.client.id)).rejects.toEqual(NF);
    await expect(quotes.getQuote(evil, quote.id)).rejects.toEqual(NF);
    expect(await quotes.listQuotes(evil)).toHaveLength(0);
    await expect(readAttachment(evil, att.id)).rejects.toEqual(NF);

    await expect(jobs.cancelJob(evil, job.id, { reason: "sabotage" })).rejects.toEqual(NF);
    await expect(jobs.assignJob(evil, job.id, { leadTechnicianId: b.tech.userId })).rejects.toEqual(NF);
    await expect(quotes.saveQuote(evil, quote.id, { scope: "", terms: "", validUntil: null, lines: [] })).rejects.toEqual(NF);
    await expect(quotes.reviseQuote(evil, quote.id)).rejects.toEqual(NF);
    await expect(approvals.recordQuoteDecision(evil, quote.id, { outcome: "APPROVED", name: "Fake", comment: "forged" })).rejects.toEqual(NF);
    await expect(approvals.createApprovalLink(evil, { quoteId: quote.id }, { recipientName: "Me", recipientEmail: "me@evil.example" })).rejects.toEqual(NF);
    await expect(clients.updateClient(evil, a.client.id, { name: "Hacked" })).rejects.toEqual(NF);
    await expect(clients.createSite(evil, { clientId: a.client.id, name: "Rogue" })).rejects.toEqual(NF);
    await expect(addJobAttachment(evil, { jobId: job.id, kind: "REQUEST", filename: "x.png", bytes: PNG })).rejects.toEqual(NF);
    expect(await status(job.id)).toBe("AWAITING_APPROVAL");
  });

  it("cross-tenant references are rejected when creating records (and by composite foreign keys)", async () => {
    const [a, b] = [await tenant(), await tenant()];
    await expect(newJob(b, b.manager, { clientId: a.client.id, siteId: a.site.id })).rejects.toEqual(code("INVALID"));
    await expect(newJob(b, b.manager, { siteId: a.site.id })).rejects.toEqual(code("INVALID"));
    const job = await newJob(a);
    await jobs.submitAssessment(a.manager, job.id, { findings: "found it", quoteRequired: false });
    await jobs.authoriseWithoutQuote(a.manager, job.id, { reason: "Contract cover" });
    await expect(jobs.assignJob(a.manager, job.id, { leadTechnicianId: b.tech.userId })).rejects.toEqual(code("INVALID"));
    await expect(orgs.inviteMember(a.owner, { email: "x@example.com", roles: ["CLIENT"], clientId: b.client.id })).rejects.toEqual(NF);
    // Even raw SQL cannot attach company A's site to a job in company B.
    await expect(prisma.job.create({
      data: { orgId: b.orgId, reference: "X-1", title: "t", description: "d", clientId: b.client.id, siteId: a.site.id, requesterId: b.owner.userId },
    })).rejects.toThrow(/Foreign key|constraint/i);
  });

  it("reports and dashboards only count the caller's tenant", async () => {
    const [a, b] = [await tenant(), await tenant()];
    await newJob(a); await newJob(a); await newJob(b);
    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    expect((await getReport(a.manager, range)).jobsOpened).toBe(2);
    expect((await getReport(b.manager, range)).jobsOpened).toBe(1);
    expect((await jobs.dashboardCounts(b.manager)).newRequests).toBe(1);
  });
});

describe("roles and customer boundaries", () => {
  it("technicians only see and act on jobs they are assigned to", async () => {
    const t = await tenant();
    const other = await member(t.orgId, ["TECHNICIAN"], null, "tech2");
    const job = await startedJob(t);
    await expect(jobs.getJob(other, job.id)).rejects.toEqual(NF);
    await expect(jobs.addWorkUpdate(other, job.id, { note: "sneaky" })).rejects.toEqual(NF);
    expect(await jobs.listJobs(other)).toHaveLength(0);
    expect(await jobs.listJobs(t.tech)).toHaveLength(1);
    for (const fn of [
      () => jobs.cancelJob(t.tech, job.id, { reason: "nope nope" }), () => jobs.closeJob(t.tech, job.id),
      () => jobs.assignJob(t.tech, job.id, { leadTechnicianId: t.tech.userId }), () => jobs.changePriority(t.tech, job.id, "LOW"),
      () => quotes.createQuote(t.tech, job.id, "VARIATION"), () => quotes.listQuotes(t.tech),
      () => orgs.inviteMember(t.tech, { email: "a@b.co", roles: ["OWNER"] }), () => clients.createClient(t.tech, { name: "X" }),
      () => getReport(t.tech, { from: new Date(0), to: new Date() }), () => orgs.listTeam(t.tech),
    ]) await expect(fn()).rejects.toEqual(FB);
    // A technician who merely reported a job cannot work on it.
    const reported = await newJob(t, other);
    await expect(jobs.submitAssessment(other, reported.id, { findings: "self-assess", quoteRequired: false })).rejects.toEqual(FB);
    expect((await jobs.getJob(t.tech, job.id)).quotes).toEqual([]); // technicians never see pricing
  });

  it("a client representative sees only their own customer's jobs and never internal data", async () => {
    const t = await tenant();
    const c2 = await clients.createClient(t.owner, { name: "Other Client" });
    const s2 = await clients.createSite(t.owner, { clientId: c2.id, name: "Depot" });
    const rep2 = await member(t.orgId, ["CLIENT"], c2.id, "rep2");
    const { job, quote } = await quotedJob(t);
    const j2 = await newJob(t, t.manager, { clientId: c2.id, siteId: s2.id });

    expect((await jobs.listJobs(t.rep)).map((j) => j.id)).toEqual([job.id]);
    await expect(jobs.getJob(t.rep, j2.id)).rejects.toEqual(NF);
    await expect(jobs.getJob(rep2, job.id)).rejects.toEqual(NF);
    await expect(quotes.getQuote(rep2, quote.id)).rejects.toEqual(NF);
    await expect(approvals.portalDecideQuote(rep2, quote.id, { outcome: "APPROVED" })).rejects.toEqual(NF);
    await expect(newJob(t, t.rep, { clientId: c2.id, siteId: s2.id })).rejects.toEqual(FB);
    expect((await clients.requestFormOptions(t.rep)).map((c) => c.id)).toEqual([t.client.id]);

    const view = await jobs.getJob(t.rep, job.id);
    expect(view.assessments).toEqual([]);
    expect(view.updates).toEqual([]);
    expect(view.events.some((e) => e.type.startsWith("assessment."))).toBe(false);
    expect(view.quotes.map((q) => q.status)).toEqual(["SUBMITTED"]);
    for (const fn of [() => clients.listClients(t.rep), () => jobs.cancelJob(t.rep, job.id, { reason: "because" }), () => quotes.reviseQuote(t.rep, quote.id),
      () => approvals.recordQuoteDecision(t.rep, quote.id, { outcome: "APPROVED", name: "x y", comment: "self" })]) await expect(fn()).rejects.toEqual(FB);

    await approvals.portalDecideQuote(t.rep, quote.id, { outcome: "APPROVED" }, "10.1.1.1");
    const d = await prisma.decision.findUniqueOrThrow({ where: { quoteId: quote.id } });
    expect(d).toMatchObject({ via: "PORTAL", deciderUserId: t.rep.userId, ipAddress: "10.1.1.1" });
  });

  it("draft quotes are invisible to customers; staff cannot use the customer decision channel", async () => {
    const t = await tenant();
    const job = await newJob(t);
    await jobs.submitAssessment(t.manager, job.id, { findings: "found it", quoteRequired: true });
    const q = await quotes.createQuote(t.manager, job.id);
    await expect(quotes.getQuote(t.rep, q.id)).rejects.toEqual(NF);
    expect((await jobs.getJob(t.rep, job.id)).quotes).toEqual([]);
    await quotes.saveQuote(t.manager, q.id, { scope: "s", terms: "", validUntil: null, lines: LINES });
    await quotes.submitQuote(t.manager, q.id);
    await expect(approvals.portalDecideQuote(t.manager, q.id, { outcome: "APPROVED" })).rejects.toEqual(FB);
    await expect(approvals.portalDecideQuote(t.tech, q.id, { outcome: "APPROVED" })).rejects.toEqual(FB);
  });

  it("a requester sees only what they reported", async () => {
    const t = await tenant();
    const req = await member(t.orgId, ["REQUESTER"], t.client.id, "req");
    const mine = await newJob(t, req);
    const theirs = await newJob(t);
    expect((await jobs.listJobs(req)).map((j) => j.id)).toEqual([mine.id]);
    await expect(jobs.getJob(req, theirs.id)).rejects.toEqual(NF);
    await expect(quotes.listQuotes(req)).rejects.toEqual(FB);
  });

  it("customer users can never be given staff roles", async () => {
    const t = await tenant();
    await expect(orgs.inviteMember(t.owner, { email: `x${uniq()}@example.com`, roles: ["CLIENT", "MANAGER"], clientId: t.client.id })).rejects.toEqual(code("INVALID"));
    await expect(orgs.inviteMember(t.owner, { email: `x${uniq()}@example.com`, roles: ["CLIENT"] })).rejects.toEqual(code("INVALID"));
    await expect(orgs.inviteMember(t.manager, { email: `x${uniq()}@example.com`, roles: ["MANAGER"] })).rejects.toEqual(FB);
    const repM = await prisma.membership.findFirstOrThrow({ where: { userId: t.rep.userId } });
    await expect(orgs.updateMember(t.owner, repM.id, { roles: ["OWNER"], active: true })).rejects.toEqual(code("INVALID"));
  });
});

describe("approval link security", () => {
  it("rejects unknown, tampered, expired, revoked and reused tokens", async () => {
    const t = await tenant();
    const { quote } = await quotedJob(t);
    const ok = { outcome: "APPROVED" as const, name: "Carl Customer" };
    const l = await linkFor(t, { quoteId: quote.id });
    expect(await prisma.approvalLink.count({ where: { tokenHash: l.token } })).toBe(0); // raw token is never stored
    expect(await approvals.getLinkView("A".repeat(43))).toBeNull();
    expect(await approvals.getLinkView("../../etc/passwd")).toBeNull();
    await expect(approvals.decideViaLink(l.token.slice(0, -1) + (l.token.endsWith("A") ? "B" : "A"), ok)).rejects.toEqual(NF);

    await prisma.approvalLink.update({ where: { id: l.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await approvals.getLinkView(l.token))?.state).toBe("expired");
    await expect(approvals.decideViaLink(l.token, ok)).rejects.toThrow(/expired/);

    const l2 = await linkFor(t, { quoteId: quote.id });
    await approvals.revokeApprovalLink(t.manager, l2.id);
    await expect(approvals.decideViaLink(l2.token, ok)).rejects.toEqual(NF);

    const l3 = await linkFor(t, { quoteId: quote.id });
    await approvals.decideViaLink(l3.token, ok);
    await expect(approvals.decideViaLink(l3.token, { outcome: "REJECTED", name: "Carl Customer", comment: "changed my mind" })).rejects.toEqual(code("CONFLICT"));
    expect((await approvals.getLinkView(l3.token))?.state).toBe("decided");
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe("APPROVED");
  });

  it("an expired quotation cannot be approved, and links never outlive the quote's validity", async () => {
    const t = await tenant();
    const { quote } = await quotedJob(t);
    await prisma.$executeRaw`ALTER TABLE "Quote" DISABLE TRIGGER quote_frozen`;
    await prisma.quote.update({ where: { id: quote.id }, data: { validUntil: new Date(Date.now() + 2 * 86_400_000) } });
    const l = await linkFor(t, { quoteId: quote.id });
    expect(l.expiresAt.getTime()).toBeLessThan(Date.now() + 4 * 86_400_000);
    await prisma.quote.update({ where: { id: quote.id }, data: { validUntil: new Date(Date.now() - 3 * 86_400_000) } });
    await prisma.$executeRaw`ALTER TABLE "Quote" ENABLE TRIGGER quote_frozen`;
    await expect(approvals.portalDecideQuote(t.rep, quote.id, { outcome: "APPROVED" })).rejects.toThrow(/expired/);
  });

  it("a link only exposes files bound to its own quote or completion", async () => {
    const t = await tenant();
    const a = await completedJob(t);
    const b = await completedJob(t);
    const la = await linkFor(t, { completionId: a.completion.id });
    const attA = await prisma.attachment.findFirstOrThrow({ where: { completionId: a.completion.id } });
    const attB = await prisma.attachment.findFirstOrThrow({ where: { completionId: b.completion.id } });
    expect((await readAttachmentViaLink(la.token, attA.id)).mimeType).toBe("image/png");
    await expect(readAttachmentViaLink(la.token, attB.id)).rejects.toEqual(NF);
    await expect(readAttachmentViaLink("B".repeat(43), attA.id)).rejects.toEqual(NF);
    // A completion link cannot be replayed against a quote, and a decided link stays decided.
    await approvals.decideViaLink(la.token, { outcome: "APPROVED", name: "Carl Customer" });
    expect(await status(b.job.id)).toBe("AWAITING_VERIFICATION");
  });

  it("only a submitted quote can be sent; technicians cannot issue links", async () => {
    const t = await tenant();
    const job = await newJob(t);
    await jobs.submitAssessment(t.manager, job.id, { findings: "found it", quoteRequired: true });
    const q = await quotes.createQuote(t.manager, job.id);
    await expect(linkFor(t, { quoteId: q.id })).rejects.toEqual(code("CONFLICT"));
    await expect(approvals.createApprovalLink(t.tech, { quoteId: q.id }, { recipientName: "Me me", recipientEmail: "me@x.co" })).rejects.toEqual(FB);
    await expect(quotes.submitQuote(t.manager, q.id)).rejects.toThrow(/line item/);
  });
});

describe("attachments", () => {
  it("accepts only real images/PDFs by content, with size limits", async () => {
    const t = await tenant();
    const job = await newJob(t);
    const up = (bytes: Buffer, filename = "f.png") => addJobAttachment(t.manager, { jobId: job.id, kind: "REQUEST", filename, bytes });
    await expect(up(Buffer.from("<script>alert(1)</script>"), "evil.png")).rejects.toEqual(code("INVALID"));
    await expect(up(Buffer.from("MZ\x90\x00binary"), "photo.jpg")).rejects.toEqual(code("INVALID"));
    await expect(up(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "x.svg")).rejects.toEqual(code("INVALID"));
    await expect(up(Buffer.alloc(0))).rejects.toEqual(code("INVALID"));
    await expect(up(Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]))).rejects.toThrow(/10 MB/);
    const ok = await up(PNG, "../../../etc/pass wd<>.png");
    expect(ok.filename).toBe("pass wd_.png");
    expect(ok.mimeType).toBe("image/png");
    expect(ok.storageKey).not.toContain("pass");
    const pdf = await up(Buffer.from("%PDF-1.7 test"), "report.exe");
    expect(pdf.mimeType).toBe("application/pdf");
    await expect(setOrgLogo(t.owner, { filename: "l.pdf", bytes: Buffer.from("%PDF-1.7") })).rejects.toEqual(code("INVALID"));
    await expect(setOrgLogo(t.manager, { filename: "l.png", bytes: PNG })).rejects.toEqual(FB);
  });

  it("enforces who may upload and who may read each kind", async () => {
    const t = await tenant();
    const job = await startedJob(t);
    const progress = await addJobAttachment(t.tech, { jobId: job.id, kind: "PROGRESS", filename: "p.png", bytes: PNG });
    const after = await addJobAttachment(t.tech, { jobId: job.id, kind: "AFTER", filename: "a.png", bytes: PNG });
    await expect(addJobAttachment(t.rep, { jobId: job.id, kind: "AFTER", filename: "a.png", bytes: PNG })).rejects.toEqual(FB);
    await expect(addJobAttachment(t.rep, { jobId: job.id, kind: "REQUEST", filename: "a.png", bytes: PNG })).rejects.toEqual(FB); // not the reporter
    await expect(addJobAttachment(t.manager, { jobId: job.id, kind: "SIGNATURE", filename: "s.png", bytes: PNG })).rejects.toEqual(code("INVALID"));
    await expect(readAttachment(t.rep, progress.id)).rejects.toEqual(NF); // internal working photo
    expect((await readAttachment(t.rep, after.id)).mimeType).toBe("image/png");
    expect((await readAttachment(t.tech, progress.id)).filename).toBe("p.png");
  });
});

describe("accounts, invitations and access revocation", () => {
  it("login, session loading, password change and logout-everywhere", async () => {
    const t = await tenant();
    await expect(login(t.owner.userEmail, "wrong-password-123")).rejects.toEqual(code("UNAUTHENTICATED"));
    await expect(login("nobody@example.com", "correct-horse-battery")).rejects.toEqual(code("UNAUTHENTICATED"));
    const tok = await login(t.owner.userEmail.toUpperCase(), "correct-horse-battery");
    const s = await loadSession(tok);
    expect(s?.ctx).toMatchObject({ orgId: t.orgId, roles: ["OWNER"], locked: false });
    expect(s?.subscription).toMatchObject({ status: "TRIALING", access: "full" });
    expect(await loadSession("garbage")).toBeNull();
    expect(await prisma.session.count({ where: { tokenHash: tok } })).toBe(0); // only the hash is stored
    await expect(changePassword(t.owner.userId, "correct-horse-battery", "short", tok)).rejects.toEqual(code("INVALID"));
    await changePassword(t.owner.userId, "correct-horse-battery", "a-much-better-password", tok);
    expect(await loadSession(t.token)).toBeNull(); // the registration session was revoked
    expect(await loadSession(tok)).not.toBeNull();
    await prisma.session.update({ where: { tokenHash: hashToken(tok) }, data: { expiresAt: new Date(0) } });
    expect(await loadSession(tok)).toBeNull();
    await expect(orgs.registerCompany({ name: "Dup", companyName: "Dup Co", email: t.owner.userEmail, password: "correct-horse-battery" })).rejects.toEqual(code("CONFLICT"));
  });

  it("invitations are single-use, expire, and grant exactly the invited role", async () => {
    const t = await tenant();
    const email = `new-${uniq()}@example.com`;
    const inv = await orgs.inviteMember(t.owner, { email, roles: ["TECHNICIAN"] });
    expect((await orgs.getInvitation(inv.token))?.hasAccount).toBe(false);
    await expect(orgs.acceptInvitation(inv.token, { name: "Tina Tech", password: "short" })).rejects.toEqual(code("INVALID"));
    const rs = await Promise.allSettled([1, 2, 3].map(() => orgs.acceptInvitation(inv.token, { name: "Tina Tech", password: "long-enough-password" })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const s = await loadSession(await login(email, "long-enough-password"));
    expect(s?.ctx).toMatchObject({ orgId: t.orgId, roles: ["TECHNICIAN"], clientId: null });
    await expect(orgs.acceptInvitation(inv.token, { name: "Again", password: "long-enough-password" })).rejects.toEqual(NF);
    await expect(orgs.inviteMember(t.owner, { email, roles: ["MANAGER"] })).rejects.toEqual(code("CONFLICT"));

    const inv2 = await orgs.inviteMember(t.owner, { email: `late-${uniq()}@example.com`, roles: ["MANAGER"] });
    await prisma.invitation.update({ where: { id: inv2.id }, data: { expiresAt: new Date(0) } });
    await expect(orgs.acceptInvitation(inv2.token, { name: "Late Larry", password: "long-enough-password" })).rejects.toEqual(NF);
    // An existing user must prove their password before an invitation attaches them to a company.
    const other = await tenant();
    const inv3 = await orgs.inviteMember(other.owner, { email, roles: ["MANAGER"] });
    await expect(orgs.acceptInvitation(inv3.token, { password: "not-their-password" })).rejects.toEqual(code("INVALID"));
  });

  it("deactivating a member revokes access immediately; the last owner is protected", async () => {
    const t = await tenant();
    const tok = await prisma.$transaction((tx) => import("@/server/auth").then((a) => a.createSession(tx, t.tech.userId, t.orgId)));
    expect((await loadSession(tok))?.ctx?.orgId).toBe(t.orgId);
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: t.tech.userId } });
    await orgs.updateMember(t.owner, m.id, { roles: ["TECHNICIAN"], active: false });
    expect((await loadSession(tok))?.ctx).toBeNull();
    const om = await prisma.membership.findFirstOrThrow({ where: { userId: t.owner.userId } });
    await expect(orgs.updateMember(t.owner, om.id, { roles: ["MANAGER"], active: true })).rejects.toThrow(/at least one active owner/);
    await expect(orgs.updateMember(t.owner, om.id, { roles: ["OWNER"], active: false })).rejects.toThrow(/at least one active owner/);
    await expect(orgs.updateMember(t.manager, m.id, { roles: ["OWNER"], active: true })).rejects.toEqual(FB);
  });

  it("a session cannot be pointed at a company the user does not belong to", async () => {
    const [a, b] = [await tenant(), await tenant()];
    await expect(switchWorkspace(a.token, b.orgId)).rejects.toEqual(FB);
    await prisma.session.updateMany({ where: { userId: a.owner.userId }, data: { activeOrgId: b.orgId } }); // even if forced in the DB…
    expect((await loadSession(a.token))?.ctx?.orgId).toBe(a.orgId); // …the context is never company B
  });
});

describe("platform operator and support access", () => {
  it("the platform operator sees no tenant data without an explicit, time-bound, audited grant — and then read-only", async () => {
    const t = await tenant();
    const job = await newJob(t);
    const admin = await prisma.user.create({ data: { email: `admin-${uniq()}@fixrelay.example`, name: "Pat Platform", passwordHash: "x", isPlatformAdmin: true } });
    const { createSession } = await import("@/server/auth");
    const tok = await createSession(prisma, admin.id, t.orgId);
    expect((await loadSession(tok))?.ctx).toBeNull();
    await expect(orgs.enterSupportSession(admin, t.orgId)).rejects.toEqual(FB);
    await expect(orgs.enterSupportSession({ ...admin, isPlatformAdmin: false }, t.orgId)).rejects.toEqual(FB);
    await expect(orgs.listTenants({ isPlatformAdmin: false })).rejects.toEqual(FB);
    await expect(orgs.grantSupportAccess(t.manager, { reason: "please help", hours: 2 })).rejects.toEqual(FB);

    const grant = await orgs.grantSupportAccess(t.owner, { reason: "Help with quote layout", hours: 500 });
    expect(grant.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 72 * 3_600_000 + 1000); // capped
    await orgs.enterSupportSession(admin, t.orgId);
    const ctx = (await loadSession(tok))!.ctx!;
    expect(ctx).toMatchObject({ support: true, roles: [] });
    expect((await jobs.getJob(ctx, job.id)).id).toBe(job.id);
    await expect(jobs.cancelJob(ctx, job.id, { reason: "support cancel" })).rejects.toEqual(FB);
    await expect(newJob(t, ctx)).rejects.toEqual(FB);
    await expect(orgs.updateOrgSettings(ctx, {} as never)).rejects.toEqual(FB);
    expect(await prisma.activityEvent.count({ where: { orgId: t.orgId, type: "support.accessed", actorUserId: admin.id } })).toBe(1);

    await orgs.revokeSupportAccess(t.owner, grant.id);
    expect((await loadSession(tok))?.ctx).toBeNull();
  });
});

describe("subscriptions and entitlements", () => {
  it("a suspended tenant becomes read-only but keeps full access to its records", async () => {
    const t = await tenant();
    const { job, quote } = await quotedJob(t);
    const admin = { id: t.owner.userId, isPlatformAdmin: true };
    await expect(setSubscription({ id: t.owner.userId, isPlatformAdmin: false }, t.orgId, { status: "ACTIVE" })).rejects.toEqual(FB);
    await setSubscription(admin, t.orgId, { status: "SUSPENDED" });
    const s = (await loadSession(t.token))!;
    expect(s.subscription).toMatchObject({ access: "locked", status: "SUSPENDED" });
    const ctx = s.ctx!;
    expect(ctx.locked).toBe(true);
    await expect(newJob(t, ctx)).rejects.toEqual(code("SUBSCRIPTION"));
    await expect(jobs.cancelJob(ctx, job.id, { reason: "locked out" })).rejects.toEqual(code("SUBSCRIPTION"));
    await expect(quotes.reviseQuote(ctx, quote.id)).rejects.toEqual(code("SUBSCRIPTION"));
    expect((await jobs.getJob(ctx, job.id)).events.length).toBeGreaterThan(0);
    expect((await quotes.getQuote(ctx, quote.id)).totalCents).toBe(285956);
    expect((await getReport(ctx, { from: new Date(0), to: new Date() })).jobsOpened).toBe(1);
    expect(await prisma.job.count({ where: { orgId: t.orgId } })).toBe(1); // nothing was deleted
    await setSubscription(admin, t.orgId, { status: "ACTIVE", planCode: "starter", currentPeriodEnd: new Date(Date.now() + 86_400_000) });
    expect((await loadSession(t.token))!.ctx!.locked).toBe(false);
  });

  it("trial → grace → locked follows the dates; plan limits are enforced from the plan row", async () => {
    const t = await tenant();
    const day = 86_400_000;
    const set = (trialEndsAt: Date) => prisma.subscription.update({ where: { orgId: t.orgId }, data: { trialEndsAt } });
    await set(new Date(Date.now() - day));
    expect((await loadSession(t.token))!.subscription!.access).toBe("grace");
    expect((await loadSession(t.token))!.ctx!.locked).toBe(false);
    await set(new Date(Date.now() - 8 * day));
    expect((await loadSession(t.token))!.subscription!.access).toBe("locked");
    await set(new Date(Date.now() + day));

    const plan = await prisma.plan.create({ data: { code: `tiny-${uniq()}`, name: "Tiny", maxUsers: 3, maxActiveJobs: 2, maxClients: 1 } });
    await prisma.subscription.update({ where: { orgId: t.orgId }, data: { planId: plan.id } });
    await expect(clients.createClient(t.owner, { name: "Second" })).rejects.toEqual(code("SUBSCRIPTION"));
    await expect(orgs.inviteMember(t.owner, { email: `m${uniq()}@example.com`, roles: ["MANAGER"] })).rejects.toThrow(/3 team members/);
    await orgs.inviteMember(t.owner, { email: `c${uniq()}@example.com`, roles: ["CLIENT"], clientId: t.client.id }); // portal users are free
    await newJob(t); await newJob(t);
    await expect(newJob(t)).rejects.toThrow(/2 open jobs/);
  });
});

describe("notifications", () => {
  it("notifies the right people once, and the outbox retries then gives up", async () => {
    const t = await tenant();
    await prisma.outboxEmail.updateMany({ where: { status: "PENDING" }, data: { status: "SENT" } }); // isolate from other tests
    const job = await newJob(t, t.rep);
    const forManager = () => prisma.notification.count({ where: { userId: t.manager.userId, jobId: job.id } });
    expect(await forManager()).toBe(1);
    expect(await prisma.notification.count({ where: { userId: t.rep.userId, jobId: job.id } })).toBe(0); // not the actor
    // Same event again → no duplicates (idempotent on dedupeKey).
    await prisma.$transaction((tx) => notifications.notify(tx, { orgId: t.orgId, jobId: job.id, type: "job.created", title: "dup", userIds: [t.manager.userId], eventKey: `job-created:${job.id}` }));
    expect(await forManager()).toBe(1);
    // Nobody outside the tenant is ever notified.
    const other = await tenant();
    await prisma.$transaction((tx) => notifications.notify(tx, { orgId: t.orgId, type: "x", title: "leak?", userIds: [other.owner.userId], eventKey: `leak:${uniq()}` }));
    expect(await prisma.notification.count({ where: { userId: other.owner.userId, title: "leak?" } })).toBe(0);

    await jobs.requestAssessment(t.manager, job.id, { assessorId: t.tech.userId });
    expect(await prisma.notification.count({ where: { userId: t.tech.userId, type: "job.assessment_requested" } })).toBe(1);

    const pending = await prisma.outboxEmail.count({ where: { status: "PENDING" } });
    expect(pending).toBeGreaterThanOrEqual(3);
    const sentTo: string[] = [];
    let fail = true;
    const flaky = { name: "test", send: async (m: { to: string }) => { if (fail) throw new Error("smtp down"); sentTo.push(m.to); } };
    let now = new Date();
    expect(await notifications.processOutbox(flaky, 50, now)).toEqual({ sent: 0, failed: pending });
    expect(await notifications.processOutbox(flaky, 50, now)).toEqual({ sent: 0, failed: 0 }); // backoff: not due yet
    const row = await prisma.outboxEmail.findFirstOrThrow({ where: { status: "PENDING" } });
    expect(row).toMatchObject({ attempts: 1, lastError: "smtp down" });
    fail = false;
    now = new Date(now.getTime() + 3 * 60_000);
    expect(await notifications.processOutbox(flaky, 50, now)).toEqual({ sent: pending, failed: 0 });
    expect(new Set(sentTo).size).toBe(sentTo.length);
    expect(await notifications.processOutbox(flaky, 50, now)).toEqual({ sent: 0, failed: 0 }); // never sent twice

    await prisma.$transaction((tx) => notifications.queueEmail(tx, { orgId: t.orgId, to: "dead@example.com", subject: "s", body: "b", dedupeKey: `dead:${uniq()}` }));
    fail = true;
    for (let i = 0; i < notifications.MAX_ATTEMPTS; i++) { now = new Date(now.getTime() + 3_600_000); await notifications.processOutbox(flaky, 5, now); }
    expect(await prisma.outboxEmail.findFirstOrThrow({ where: { toEmail: "dead@example.com" } })).toMatchObject({ status: "FAILED", attempts: notifications.MAX_ATTEMPTS });
  });

  it("overdue jobs notify once", async () => {
    const t = await tenant();
    const job = await newJob(t);
    await prisma.job.update({ where: { id: job.id }, data: { dueAt: new Date(Date.now() - 3_600_000) } });
    await notifications.scanOverdue();
    await notifications.scanOverdue();
    expect(await prisma.notification.count({ where: { jobId: job.id, type: "job.overdue", userId: t.manager.userId } })).toBe(1);
    expect((await jobs.dashboardCounts(t.manager)).overdue).toBe(1);
    expect((await jobs.listJobs(t.manager, { overdue: true })).map((j) => j.id)).toEqual([job.id]);
  });
});
