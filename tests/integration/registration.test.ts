import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { loadSession } from "@/server/auth";
import { verifyEmail } from "@/server/services/account";
import * as departments from "@/server/services/departments";
import * as reg from "@/server/services/registration";
import { code, photo, tenant, uniq } from "../helpers";

const verifyFromOutbox = async (email: string) => {
  const mail = await prisma.outboxEmail.findFirstOrThrow({ where: { toEmail: email, subject: { contains: "Confirm your email" } }, orderBy: { createdAt: "desc" } });
  return verifyEmail(/verify-email\/([A-Za-z0-9_-]+)/.exec(mail.body)![1]!);
};

describe("employee registration with a site code", () => {
  it("a code only creates a pending request: no access until the email is confirmed and an administrator approves", async () => {
    const t = await tenant();
    const ops = await departments.createDepartment(t.owner, { name: "Operations" });
    await expect(reg.createJoinCode(t.manager, {})).rejects.toEqual(code("FORBIDDEN"));
    const c = await reg.createJoinCode(t.owner, { siteId: t.site.id, days: 7 });
    expect(c.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const info = await reg.lookupJoinCode(c.code.toLowerCase().replace("-", " "));
    expect(info).toMatchObject({ orgName: expect.stringContaining("Acme Foods"), siteName: "Germiston Plant", departments: [{ name: "Operations" }] });

    const email = `nomsa-${uniq()}@example.com`;
    const r = await reg.registerWithCode({ code: c.code, name: "Nomsa Dube", email, password: "a long enough password", departmentId: ops.id, jobTitle: "Shift supervisor", phone: "082 555 0199" }, await photo(400, 600));
    const s = await loadSession(r.token);
    expect(s?.ctx).toBeNull(); // signed in, but sees nothing from the company
    expect(await reg.myPendingRequest(r.userId)).toMatchObject({ emailVerified: false });
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: r.userId } });
    expect(m).toMatchObject({ status: "PENDING", active: false, siteIds: [t.site.id], requestedDepartmentId: ops.id, roles: ["REQUESTER"] });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: r.userId } })).photoKey).toBeTruthy();
    expect(await prisma.notification.count({ where: { userId: t.owner.userId, type: "team.requested" } })).toBe(1);
    await expect(reg.registerWithCode({ code: c.code, name: "Again", email, password: "a long enough password" })).rejects.toEqual(code("CONFLICT"));

    const pending = await reg.listPendingMembers(t.owner);
    expect(pending.map((p) => p.user.email)).toEqual([email]);
    await expect(reg.approveMember(t.owner, m.id, { roles: ["TECHNICIAN"] })).rejects.toThrow(/not confirmed their email/);
    expect(await verifyFromOutbox(email)).toBe(true);
    const other = await tenant();
    await expect(reg.approveMember(other.owner, m.id, { roles: ["TECHNICIAN"] })).rejects.toEqual(code("NOT_FOUND")); // never across companies
    await reg.approveMember(t.owner, m.id, { roles: ["TECHNICIAN"], departmentId: ops.id, departmentManager: true });
    const after = await loadSession(r.token);
    expect(after?.ctx).toMatchObject({ roles: ["TECHNICIAN"], siteIds: [t.site.id], managedDepartmentIds: [ops.id] });
    expect(await prisma.outboxEmail.count({ where: { toEmail: email, subject: { contains: "approved" } } })).toBe(1);
    await expect(reg.approveMember(t.owner, m.id, { roles: ["OWNER"] })).rejects.toEqual(code("NOT_FOUND")); // handled once
  });

  it("codes expire, can be switched off and replaced; declined requests get no access", async () => {
    const t = await tenant();
    const c = await reg.createJoinCode(t.owner, {});
    const replaced = await reg.regenerateJoinCode(t.owner, c.id);
    expect(replaced.code).not.toBe(c.code);
    expect(await reg.lookupJoinCode(c.code)).toBeNull();
    await expect(reg.registerWithCode({ code: c.code, name: "Late", email: `late-${uniq()}@example.com`, password: "a long enough password" })).rejects.toEqual(code("INVALID"));
    await prisma.joinCode.update({ where: { id: replaced.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await reg.lookupJoinCode(replaced.code)).toBeNull();
    const fresh = await reg.createJoinCode(t.owner, {});
    const r = await reg.registerWithCode({ code: fresh.code, name: "Pieter", email: `pieter-${uniq()}@example.com`, password: "a long enough password" });
    const m = await prisma.membership.findFirstOrThrow({ where: { userId: r.userId } });
    await reg.rejectMember(t.owner, m.id, { reason: "Not employed here" });
    expect(await prisma.membership.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: "REJECTED", active: false });
    expect((await loadSession(r.token))?.ctx).toBeNull();
    await reg.revokeJoinCode(t.owner, fresh.id);
    expect(await reg.listJoinCodes(t.owner)).toEqual([]);
  });
});
