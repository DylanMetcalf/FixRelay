import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createSession, loadSession, login, setViewAs } from "@/server/auth";
import { createDemoWorkspace, listPersonas, resetDemoWorkspace } from "@/server/services/demo";
import { acceptInvitation } from "@/server/services/orgs";
import * as platform from "@/server/services/platform";
import { code, tenant, uniq } from "../helpers";

const adminUser = async () => {
  const u = await prisma.user.create({ data: { email: `ops-${uniq()}@example.com`, name: "Platform Owner", passwordHash: "x", isPlatformAdmin: true, emailVerifiedAt: new Date() } });
  return { id: u.id, name: u.name, isPlatformAdmin: true };
};

describe("ManOp platform administration", () => {
  it("creates a customer with its first site, departments and an administrator invitation; shows account facts only", async () => {
    const admin = await adminUser();
    const t = await tenant();
    await expect(platform.createCustomer({ id: t.owner.userId, name: "x", isPlatformAdmin: false }, { companyName: "X", siteName: "Y", contactName: "Z Z", contactEmail: "z@example.com" })).rejects.toEqual(code("FORBIDDEN"));
    const email = `boss-${uniq()}@example.com`;
    const r = await platform.createCustomer(admin, { companyName: `Spanjaard Pilot ${uniq()}`, siteName: "Alrode Plant", contactName: "Bongi Khumalo", contactEmail: email, departments: ["Maintenance", "Operations"] });
    expect(r.inviteLink).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: r.orgId }, include: { subscription: true } });
    expect(org.subscription?.status).toBe("TRIALING");
    expect(await prisma.site.findFirstOrThrow({ where: { orgId: r.orgId } })).toMatchObject({ name: "Alrode Plant", publicCode: expect.stringMatching(/^[a-z2-9]{10}$/) });
    expect((await prisma.department.findMany({ where: { orgId: r.orgId } })).map((d) => d.name).sort()).toEqual(["Maintenance", "Operations"]);
    expect(await prisma.outboxEmail.count({ where: { toEmail: email } })).toBe(1);

    let row = (await platform.platformOverview(admin)).find((x) => x.id === r.orgId)!;
    expect(row.contact).toMatchObject({ email, joined: false });
    expect(row.onboarded).toBe(2); // site + departments
    const token = r.inviteLink.split("/invite/")[1]!;
    await acceptInvitation(token, { name: "Bongi Khumalo", password: "a long enough password" });
    row = (await platform.platformOverview(admin)).find((x) => x.id === r.orgId)!;
    expect(row.contact).toMatchObject({ name: "Bongi Khumalo", joined: true });
    const detail = await platform.customerDetail(admin, r.orgId);
    expect(detail!.members[0]).toMatchObject({ roles: ["OWNER", "MANAGER"], user: { email } });
    expect(Object.keys(detail!)).not.toContain("jobs"); // no business data
    expect(await platform.customerDetail(admin, (await prisma.organisation.findFirstOrThrow({ where: { isDemo: true } }).catch(() => ({ id: "00000000-0000-0000-0000-000000000000" }))).id)).toBeNull();
  });
});

describe("demo environment", () => {
  it("is built from synthetic data with departments and sample people, never sends email, and personas cannot sign in", async () => {
    const t = await tenant();
    const me = { id: t.owner.userId, name: t.owner.userName, email: t.owner.userEmail };
    const orgId = await createDemoWorkspace(me);
    const personas = await listPersonas(orgId);
    expect(personas.map((p) => p.user.jobTitle)).toEqual(["Site administrator", "Maintenance manager", "Maintenance technician", "Finance manager", "Operations manager", "Packing line operator"]);
    expect(await prisma.department.count({ where: { orgId } })).toBe(4);
    const statuses = (await prisma.job.findMany({ where: { orgId }, select: { status: true } })).map((j) => j.status);
    for (const st of ["NEW", "QUOTING", "IN_PROGRESS", "AWAITING_APPROVAL", "ASSIGNED", "CLOSED"]) expect(statuses).toContain(st);
    expect(await prisma.job.count({ where: { orgId, reopenCount: { gt: 0 } } })).toBe(1);
    expect(await prisma.job.count({ where: { orgId, duplicateStatus: "FLAGGED" } })).toBeGreaterThanOrEqual(1);
    expect(await prisma.jobHandover.count({ where: { orgId } })).toBe(1);
    expect(await prisma.attachment.count({ where: { orgId, kind: "REQUEST" } })).toBeGreaterThanOrEqual(3);
    expect(await prisma.outboxEmail.count({ where: { orgId } })).toBe(0); // nothing leaves a demo company
    const persona = await prisma.user.findUniqueOrThrow({ where: { id: personas[2]!.userId } });
    expect(persona.email).toMatch(/@demo\.manop\.invalid$/);
    await expect(login(persona.email, "anything at all")).rejects.toEqual(code("UNAUTHENTICATED"));
  });

  it("'view as' works only in the demo company, only for its owner, only as a sample person; reset rebuilds it", async () => {
    const t = await tenant();
    const me = { id: t.owner.userId, name: t.owner.userName, email: t.owner.userEmail };
    const orgId = await createDemoWorkspace(me);
    const tech = (await listPersonas(orgId))[2]!;
    const token = await createSession(prisma, me.id, orgId);
    await setViewAs(token, tech.userId);
    const s = await loadSession(token);
    expect(s?.viewAs?.name).toBe("Jabu Mokoena");
    expect(s?.ctx).toMatchObject({ userId: tech.userId, roles: ["TECHNICIAN"] });
    await setViewAs(token, null);
    expect((await loadSession(token))?.ctx?.userId).toBe(me.id);

    // In a real company: refused, and a forged session value is ignored.
    const real = await createSession(prisma, me.id, t.orgId);
    await expect(setViewAs(real, tech.userId)).rejects.toEqual(code("FORBIDDEN"));
    await expect(setViewAs(real, t.tech.userId)).rejects.toEqual(code("FORBIDDEN"));
    await prisma.session.updateMany({ where: { userId: me.id, activeOrgId: t.orgId }, data: { actAsUserId: t.tech.userId } });
    expect((await loadSession(real))?.ctx?.userId).toBe(me.id);
    // A non-owner member of the demo cannot view as anyone.
    const techToken = await createSession(prisma, tech.userId, orgId);
    await expect(setViewAs(techToken, (await listPersonas(orgId))[0]!.userId)).rejects.toEqual(code("FORBIDDEN"));

    const fresh = await resetDemoWorkspace(me);
    expect(fresh).not.toBe(orgId);
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: orgId } })).archivedAt).not.toBeNull();
    expect(await prisma.membership.count({ where: { orgId, active: true } })).toBe(0);
    await expect(createDemoWorkspace(me)).rejects.toEqual(code("CONFLICT")); // one live demo per person
  });
});

describe("public sandbox (no sign-up)", () => {
  it("gives each visitor a private demo company that expires; guests cannot sign in with a password; clean-up archives it", async () => {
    const { startSandbox, cleanupSandboxes } = await import("@/server/services/demo");
    const a = await startSandbox();
    const b = await startSandbox();
    expect(a.orgId).not.toBe(b.orgId); // never shared between visitors
    const s = await loadSession(a.token);
    expect(s?.ctx?.roles).toEqual(["OWNER", "MANAGER", "TECHNICIAN"]);
    expect(s?.org).toMatchObject({ isDemo: true, name: "Demo Foods – your sandbox" });
    expect(await prisma.job.count({ where: { orgId: a.orgId } })).toBeGreaterThan(10);
    expect(await prisma.job.count({ where: { orgId: a.orgId, mode: "SELF" } })).toBe(2);
    const guest = await prisma.user.findUniqueOrThrow({ where: { id: s!.user.id } });
    expect(guest.email).toMatch(/@sandbox\.manop\.invalid$/);
    await expect(login(guest.email, "anything at all")).rejects.toEqual(code("UNAUTHENTICATED"));
    expect(await prisma.outboxEmail.count({ where: { orgId: a.orgId } })).toBe(0);

    await prisma.user.update({ where: { id: guest.id }, data: { guestExpiresAt: new Date(Date.now() - 1000) } });
    expect(await loadSession(a.token)).toBeNull(); // expired: the session no longer works
    expect(await cleanupSandboxes()).toBeGreaterThanOrEqual(1);
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: a.orgId } })).archivedAt).not.toBeNull();
    expect(await prisma.session.count({ where: { userId: guest.id } })).toBe(0);
    expect((await loadSession(b.token))?.ctx).toBeTruthy(); // other visitors unaffected
  });
});
