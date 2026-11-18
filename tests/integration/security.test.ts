import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { changePassword, createSession, loadSession, login, switchWorkspace } from "@/server/auth";
import * as approvals from "@/server/services/approvals";
import { addJobAttachment, readAttachment, readAttachmentViaLink, setOrgLogo } from "@/server/services/attachments";
import { setSubscription } from "@/server/services/billing";
import * as contractors from "@/server/services/contractors";
import * as jobs from "@/server/services/jobs";
import * as notifications from "@/server/services/notifications";
import * as orgs from "@/server/services/orgs";
import * as portal from "@/server/services/portal";
import * as quotes from "@/server/services/quotes";
import { getReport } from "@/server/services/reports";
import * as sites from "@/server/services/sites";
import { appointedJob, assessedJob, code, inHouseJob, linkFromEmail, member, newJob, PNG, quotingJob, status, tenant, uniq } from "../helpers";

const NF = code("NOT_FOUND");
const FB = code("FORBIDDEN");

describe("tenant isolation", () => {
  it("another organisation cannot read or change anything", async () => {
    const [a, b] = [await tenant(), await tenant()];
    const { job, quotes: qs } = await quotingJob(a, [100000]);
    const att = await addJobAttachment(a.manager, { jobId: job.id, kind: "REQUEST", filename: "x.png", bytes: PNG });
    const evil = b.owner;
    await expect(jobs.getJob(evil, job.id)).rejects.toEqual(NF);
    expect(await jobs.listJobs(evil)).toHaveLength(0);
    await expect(sites.getSite(evil, a.site.id)).rejects.toEqual(NF);
    await expect(contractors.getContractor(evil, a.contractors[0].id)).rejects.toEqual(NF);
    await expect(quotes.getQuote(evil, qs[0]!.id)).rejects.toEqual(NF);
    await expect(readAttachment(evil, att.id)).rejects.toEqual(NF);
    await expect(jobs.cancelJob(evil, job.id, { reason: "sabotage" })).rejects.toEqual(NF);
    await expect(approvals.approveQuote(evil, qs[0]!.id, {})).rejects.toEqual(NF);
    await expect(quotes.recordQuote(evil, job.id, b.contractors[0].id, { scope: "fake quote", priceExclVatCents: 1 })).rejects.toEqual(NF);
    await expect(sites.createLocation(evil, { siteId: a.site.id, name: "Rogue" })).rejects.toEqual(NF);
    await expect(contractors.updateContractor(evil, a.contractors[0].id, { name: "Hacked", email: "h@x.test" })).rejects.toEqual(NF);
    expect(await status(job.id)).toBe("QUOTING");
  });

  it("cross-organisation references are rejected (and blocked by composite foreign keys)", async () => {
    const [a, b] = [await tenant(), await tenant()];
    await expect(newJob(b, b.requester, { siteId: a.site.id, locationId: null, assetId: null })).rejects.toEqual(code("INVALID"));
    await expect(newJob(b, b.requester, { locationId: a.location.id })).rejects.toEqual(code("INVALID"));
    const job = await assessedJob(b);
    await expect(quotes.requestQuotes(b.manager, job.id, { contractorIds: [a.contractors[0].id], scope: "Steal a contractor", deadline: null })).rejects.toEqual(code("INVALID"));
    await expect(prisma.job.create({ data: { orgId: b.orgId, reference: "X-1", title: "t", description: "d", siteId: a.site.id, requesterId: b.owner.userId } })).rejects.toThrow(/Foreign key|constraint/i);
    await expect(prisma.job.update({ where: { id: job.id }, data: { route: "CONTRACTOR", contractorId: a.contractors[0].id } })).rejects.toThrow(/Foreign key|constraint/i);
  });

  it("reports and dashboards only count the caller's organisation", async () => {
    const [a, b] = [await tenant(), await tenant()];
    await newJob(a); await newJob(a); await newJob(b);
    const range = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    expect((await getReport(a.manager, range)).jobsOpened).toBe(2);
    expect((await getReport(b.approver, range)).jobsOpened).toBe(1);
    expect((await jobs.dashboardCounts(b.manager)).newRequests).toBe(1);
  });
});

describe("roles", () => {
  it("requesters see only their own reports, never prices or internal work notes", async () => {
    const t = await tenant();
    const other = await member(t.orgId, ["REQUESTER"]);
    const mine = await newJob(t);
    const theirs = await newJob(t, other);
    expect((await jobs.listJobs(t.requester)).map((j) => j.id)).toEqual([mine.id]);
    await expect(jobs.getJob(t.requester, theirs.id)).rejects.toEqual(NF);
    await jobs.requestAssessment(t.manager, mine.id, { assessorId: t.tech.userId });
    await jobs.submitAssessment(t.tech, mine.id, { findings: "internal finding", quoteRequired: true });
    await quotes.requestQuotes(t.manager, mine.id, { contractorIds: [t.contractors[0].id], scope: "Replace it all", deadline: null });
    await quotes.recordQuote(t.manager, mine.id, t.contractors[0].id, { scope: "price", priceExclVatCents: 100000 });
    const v = await jobs.getJob(t.requester, mine.id);
    expect(v.quotes).toEqual([]);
    expect(v.assessments).toEqual([]);
    expect(v.contractorLinks).toEqual([]);
    expect(v.events.some((e) => e.type.startsWith("assessment."))).toBe(false);
    await expect(quotes.listQuotes(t.requester)).rejects.toEqual(FB);
    await expect(sites.listSites(t.requester)).rejects.toEqual(FB);
    await expect(jobs.cancelJob(t.requester, mine.id, { reason: "I changed my mind" })).rejects.toEqual(FB);
  });

  it("technicians only act on jobs assigned to them and never see prices", async () => {
    const t = await tenant();
    const other = await member(t.orgId, ["TECHNICIAN"], [], "tech2");
    const job = await inHouseJob(t);
    await expect(jobs.getJob(other, job.id)).rejects.toEqual(NF);
    await expect(jobs.addWorkUpdate(other, job.id, { note: "sneaky" })).rejects.toEqual(NF);
    for (const fn of [() => jobs.cancelJob(t.tech, job.id, { reason: "nope nope" }), () => jobs.closeJob(t.tech, job.id),
      () => quotes.listQuotes(t.tech), () => contractors.createContractor(t.tech, { name: "X Co", email: "x@x.test" }),
      () => getReport(t.tech, { from: new Date(0), to: new Date() }), () => orgs.listTeam(t.tech), () => approvals.approveQuote(t.tech, job.id, {})])
      await expect(fn()).rejects.toEqual(FB);
    const reported = await newJob(t, other);
    await expect(jobs.submitAssessment(other, reported.id, { findings: "self-assess", quoteRequired: false })).rejects.toEqual(FB);
  });

  it("approvers see everything at their sites and approve spend, but do not run jobs", async () => {
    const t = await tenant();
    const { job } = await quotingJob(t, [100000]);
    expect((await jobs.getJob(t.approver, job.id)).quotes).toHaveLength(1);
    await expect(jobs.cancelJob(t.approver, job.id, { reason: "not mine to cancel" })).rejects.toEqual(FB);
    await expect(quotes.requestQuotes(t.approver, job.id, { contractorIds: [t.contractors[1].id], scope: "more quotes", deadline: null })).rejects.toEqual(FB);
    await expect(jobs.assignJob(t.approver, job.id, { leadTechnicianId: t.tech.userId })).rejects.toEqual(FB);
  });

  it("a member limited to one site cannot see, report at or approve for another site", async () => {
    const t = await tenant();
    const other = await sites.createSite(t.owner, { name: "Midrand DC" });
    const siteMgr = await member(t.orgId, ["MANAGER", "APPROVER"], [t.site.id], "sitemgr");
    const there = await jobs.createJob(t.owner, { title: "Dock leveller stuck", description: "Won't lower", siteId: other.id });
    await expect(jobs.getJob(siteMgr, there.id)).rejects.toEqual(NF);
    expect((await sites.listSites(siteMgr)).map((s) => s.id)).toEqual([t.site.id]);
    await expect(jobs.createJob(siteMgr, { title: "Something there", description: "Elsewhere", siteId: other.id })).rejects.toEqual(code("INVALID"));
    await jobs.submitAssessment(t.owner, there.id, { findings: "Hydraulics", quoteRequired: true });
    await quotes.requestQuotes(t.owner, there.id, { contractorIds: [t.contractors[0].id], scope: "Fix leveller", deadline: null });
    const q = await quotes.recordQuote(t.owner, there.id, t.contractors[0].id, { scope: "Fix leveller", priceExclVatCents: 100000 });
    await expect(approvals.approveQuote(siteMgr, q.id, {})).rejects.toEqual(NF);
    await approvals.recommendQuote(t.owner, q.id, {}).catch(() => null);
    const ids = await prisma.$transaction((tx) => approvals.approverIdsFor(tx, t.orgId, other.id, 115000));
    expect(ids).not.toContain(siteMgr.userId);
    expect((await getReport(siteMgr, { from: new Date(0), to: new Date(Date.now() + 86_400_000) })).jobsOpened).toBe(0);
  });

  it("only the owner invites staff; managers may invite people who only report faults", async () => {
    const t = await tenant();
    await expect(orgs.inviteMember(t.manager, { email: `m${uniq()}@example.com`, roles: ["APPROVER"] })).rejects.toEqual(FB);
    await orgs.inviteMember(t.manager, { email: `r${uniq()}@example.com`, roles: ["REQUESTER"], siteIds: [t.site.id] });
    const other = await tenant();
    await expect(orgs.inviteMember(t.owner, { email: `x${uniq()}@example.com`, roles: ["TECHNICIAN"], siteIds: [other.site.id] })).rejects.toEqual(code("INVALID"));
  });
});

describe("contractor links", () => {
  it("are stored hashed, scoped to one job and one contractor, and stop at the right moments", async () => {
    const t = await tenant();
    const job = await assessedJob(t);
    await addJobAttachment(t.manager, { jobId: job.id, kind: "REQUEST", filename: "fault.png", bytes: PNG });
    const progress = await addJobAttachment(t.tech, { jobId: job.id, kind: "ASSESSMENT", filename: "assess.png", bytes: PNG });
    await quotes.requestQuotes(t.manager, job.id, { contractorIds: [t.contractors[0].id, t.contractors[1].id], scope: "Quote please", deadline: null });
    const [ta, tb] = [await linkFromEmail(t.contractors[0].email), await linkFromEmail(t.contractors[1].email)];
    expect(await prisma.contractorLink.count({ where: { tokenHash: ta } })).toBe(0);
    expect(await portal.getContractorLinkView("A".repeat(43))).toBeNull();
    expect(await portal.getContractorLinkView("../../etc/passwd")).toBeNull();
    await portal.submitQuoteViaLink(ta, { scope: "A's price", priceExclVatCents: 100000 }, [{ filename: "a-quote.pdf", bytes: Buffer.from("%PDF-1.4 secret prices") }]);
    const aDoc = await prisma.attachment.findFirstOrThrow({ where: { jobId: job.id, kind: "QUOTE" } });
    // B sees the fault photos but never A's quote document or price.
    expect((await readAttachmentViaLink(tb, progress.id)).mimeType).toBe("image/png");
    await expect(readAttachmentViaLink(tb, aDoc.id)).rejects.toEqual(NF);
    expect((await portal.getContractorLinkView(tb))!.myQuotes).toEqual([]);
    expect((await readAttachmentViaLink(ta, aDoc.id)).mimeType).toBe("application/pdf");
    // A quote link cannot be used to submit completion; after the award it is read-only.
    await expect(portal.submitCompletionViaLink(ta, { rootCauses: ["WEAR_AND_TEAR"], workPerformed: "pretend done" }, [{ filename: "a.png", bytes: PNG }])).rejects.toEqual(NF);
    const q = await prisma.quote.findFirstOrThrow({ where: { jobId: job.id, status: "SUBMITTED" } });
    await approvals.approveQuote(t.manager, q.id, {});
    await expect(portal.submitQuoteViaLink(tb, { scope: "late quote", priceExclVatCents: 1 }, [])).rejects.toEqual(NF);
    expect((await portal.getContractorLinkView(tb))!.state).toBe("closed");
    // Expired completion link.
    const done = await linkFromEmail(t.contractors[0].email);
    await prisma.contractorLink.updateMany({ where: { jobId: job.id, purpose: "COMPLETION" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(portal.submitCompletionViaLink(done, { rootCauses: ["WEAR_AND_TEAR"], workPerformed: "finished it" }, [{ filename: "a.png", bytes: PNG }])).rejects.toThrow(/expired/);
  });

  it("a contractor that was not appointed cannot submit completion even with a valid-looking link", async () => {
    const t = await tenant();
    const { job } = await appointedJob(t);
    const loser = t.contractors[1];
    const fake = await prisma.$transaction(async (tx) => {
      const { issueCompletionLink } = await import("@/server/services/contractor-links");
      return issueCompletionLink(tx, t.manager, { ...(await tx.job.findUniqueOrThrow({ where: { id: job.id } })), contractorId: loser.id });
    });
    await expect(portal.submitCompletionViaLink(new URL(fake!.url).pathname.split("/").pop()!, { rootCauses: ["WEAR_AND_TEAR"], workPerformed: "not mine to do" }, [{ filename: "a.png", bytes: PNG }])).rejects.toThrow(/not waiting for your completion/);
  });
});

describe("uploads", () => {
  it("accept only real images/PDFs by content, with size limits; requesters can't open internal photos", async () => {
    const t = await tenant();
    const job = await inHouseJob(t);
    const up = (bytes: Buffer, filename = "f.png") => addJobAttachment(t.manager, { jobId: job.id, kind: "REQUEST", filename, bytes });
    await expect(up(Buffer.from("<script>alert(1)</script>"), "evil.png")).rejects.toEqual(code("INVALID"));
    await expect(up(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), "x.svg")).rejects.toEqual(code("INVALID"));
    await expect(up(Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]))).rejects.toThrow(/10 MB/);
    expect((await up(PNG, "../../etc/pass wd<>.png")).filename).toBe("pass wd_.png");
    await expect(setOrgLogo(t.manager, { filename: "l.png", bytes: PNG })).rejects.toEqual(FB);
    const progress = await addJobAttachment(t.tech, { jobId: job.id, kind: "PROGRESS", filename: "p.png", bytes: PNG });
    await expect(readAttachment(t.requester, progress.id)).rejects.toEqual(NF);
  });
});

describe("accounts and access", () => {
  it("login, sessions, password change and logout-everywhere", async () => {
    const t = await tenant();
    await expect(login(t.owner.userEmail, "wrong-password-123")).rejects.toEqual(code("UNAUTHENTICATED"));
    const tok = await login(t.owner.userEmail.toUpperCase(), "correct-horse-battery");
    expect((await loadSession(tok))?.ctx).toMatchObject({ orgId: t.orgId, roles: ["OWNER"], siteIds: [] });
    await changePassword(t.owner.userId, "correct-horse-battery", "a-much-better-password", tok);
    expect(await loadSession(t.token)).toBeNull();
    expect(await loadSession(tok)).not.toBeNull();
  });

  it("invitations are single-use, carry roles and site limits; deactivation is immediate; the last owner is protected", async () => {
    const t = await tenant();
    const email = `new-${uniq()}@example.com`;
    const inv = await orgs.inviteMember(t.owner, { email, roles: ["APPROVER"], siteIds: [t.site.id] });
    const rs = await Promise.allSettled([1, 2].map(() => orgs.acceptInvitation(inv.token, { name: "Anna Approver", password: "long-enough-password" })));
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const s = await loadSession(await login(email, "long-enough-password"));
    expect(s?.ctx).toMatchObject({ roles: ["APPROVER"], siteIds: [t.site.id] });
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: s!.user.id } });
    const tok = await createSession(prisma, s!.user.id, t.orgId);
    await orgs.updateMember(t.owner, m.id, { roles: ["APPROVER"], active: false });
    expect((await loadSession(tok))?.ctx).toBeNull();
    const om = await prisma.membership.findFirstOrThrow({ where: { userId: t.owner.userId } });
    await expect(orgs.updateMember(t.owner, om.id, { roles: ["MANAGER"], active: true })).rejects.toThrow(/at least one active owner/);
  });

  it("a session cannot be pointed at an organisation the user does not belong to", async () => {
    const [a, b] = [await tenant(), await tenant()];
    await expect(switchWorkspace(a.token, b.orgId)).rejects.toEqual(FB);
  });

  it("the platform operator needs a time-limited, audited grant and is then read-only", async () => {
    const t = await tenant();
    const job = await newJob(t);
    const admin = await prisma.user.create({ data: { email: `admin-${uniq()}@fixrelay.example`, name: "Pat Platform", passwordHash: "x", isPlatformAdmin: true } });
    const tok = await createSession(prisma, admin.id, t.orgId);
    expect((await loadSession(tok))?.ctx).toBeNull();
    await expect(orgs.enterSupportSession(admin, t.orgId)).rejects.toEqual(FB);
    await orgs.grantSupportAccess(t.owner, { reason: "Help with approval rules", hours: 4 });
    await orgs.enterSupportSession(admin, t.orgId);
    const ctx = (await loadSession(tok))!.ctx!;
    expect((await jobs.getJob(ctx, job.id)).id).toBe(job.id);
    await expect(jobs.cancelJob(ctx, job.id, { reason: "support cancel" })).rejects.toEqual(FB);
  });
});

describe("subscriptions", () => {
  it("a suspended account is read-only but keeps its records; plan limits count sites and staff, not requesters", async () => {
    const t = await tenant();
    const job = await newJob(t);
    await setSubscription({ id: t.owner.userId, isPlatformAdmin: true }, t.orgId, { status: "SUSPENDED" });
    const ctx = (await loadSession(t.token))!.ctx!;
    await expect(jobs.createJob(ctx, { title: "New fault", description: "x y z", siteId: t.site.id })).rejects.toEqual(code("SUBSCRIPTION"));
    expect((await jobs.getJob(ctx, job.id)).id).toBe(job.id);
    await setSubscription({ id: t.owner.userId, isPlatformAdmin: true }, t.orgId, { status: "ACTIVE" });
    const plan = await prisma.plan.create({ data: { code: `tiny-${uniq()}`, name: "Tiny", maxUsers: 4, maxActiveJobs: 50, maxSites: 1 } });
    await prisma.subscription.update({ where: { orgId: t.orgId }, data: { planId: plan.id } });
    await expect(sites.createSite(t.owner, { name: "Second site" })).rejects.toEqual(code("SUBSCRIPTION"));
    await expect(orgs.inviteMember(t.owner, { email: `m${uniq()}@example.com`, roles: ["TECHNICIAN"] })).rejects.toThrow(/4 team members/);
    await orgs.inviteMember(t.owner, { email: `r${uniq()}@example.com`, roles: ["REQUESTER"] }); // fault reporters are free
  });
});

describe("notifications and email", () => {
  it("deduplicates, retries with backoff, gives up, and never sends to reserved demo/test domains", async () => {
    const t = await tenant();
    await prisma.outboxEmail.updateMany({ where: { status: "PENDING" }, data: { status: "SENT" } });
    const job = await newJob(t);
    expect(await prisma.notification.count({ where: { userId: t.manager.userId, jobId: job.id } })).toBe(1);
    await prisma.$transaction((tx) => notifications.notify(tx, { orgId: t.orgId, jobId: job.id, type: "job.created", title: "dup", userIds: [t.manager.userId], eventKey: `job-created:${job.id}` }));
    expect(await prisma.notification.count({ where: { userId: t.manager.userId, jobId: job.id } })).toBe(1);
    await prisma.outboxEmail.updateMany({ where: { status: "PENDING" }, data: { status: "SENT" } });
    const [real, demo, test] = [`real.${uniq()}@gmail.com`, `quotes-${uniq()}@cooltech.example`, `x-${uniq()}@contractor.test`];
    await prisma.$transaction(async (tx) => {
      await notifications.queueEmail(tx, { orgId: t.orgId, to: real, subject: "s", body: "b", dedupeKey: `real:${uniq()}` });
      await notifications.queueEmail(tx, { orgId: t.orgId, to: demo, subject: "s", body: "b", dedupeKey: `demo:${uniq()}` });
      await notifications.queueEmail(tx, { orgId: t.orgId, to: test, subject: "s", body: "b", dedupeKey: `test:${uniq()}` });
    });
    const sent: string[] = [];
    let fail = true;
    const tr = { name: "test", send: async (m: { to: string }) => { if (fail) throw new Error("smtp down"); sent.push(m.to); } };
    let now = new Date();
    expect(await notifications.processOutbox(tr, 50, now)).toEqual({ sent: 0, failed: 1 }); // reserved ones are skipped, not failed
    expect(await prisma.outboxEmail.count({ where: { toEmail: { in: [demo, test] }, body: "[not sent: reserved domain]" } })).toBe(2);
    fail = false; now = new Date(now.getTime() + 3 * 60_000);
    expect(await notifications.processOutbox(tr, 50, now)).toEqual({ sent: 1, failed: 0 });
    expect(sent).toEqual([real]);
    expect(notifications.isReservedAddress("a@example.com")).toBe(true);
    expect(notifications.isReservedAddress("a@notexample.com")).toBe(false);
  });

  it("overdue jobs notify once", async () => {
    const t = await tenant();
    const job = await newJob(t);
    await prisma.job.update({ where: { id: job.id }, data: { dueAt: new Date(Date.now() - 3_600_000) } });
    await notifications.scanOverdue(); await notifications.scanOverdue();
    expect(await prisma.notification.count({ where: { jobId: job.id, type: "job.overdue", userId: t.manager.userId } })).toBe(1);
  });
});
