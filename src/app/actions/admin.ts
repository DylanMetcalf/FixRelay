"use server";
import type { Role, SubscriptionStatus } from "@prisma/client";
import { forbidden } from "@/lib/errors";
import { switchWorkspace } from "@/server/auth";
import { setOrgLogo } from "@/server/services/attachments";
import { setSubscription } from "@/server/services/billing";
import * as contractors from "@/server/services/contractors";
import * as departments from "@/server/services/departments";
import * as sites from "@/server/services/sites";
import { parseRandToCents } from "@/lib/money";
import * as orgs from "@/server/services/orgs";
import * as registration from "@/server/services/registration";
import { type ActionState, bool, fileOf, list, run, str } from "../_lib/action";
import { getSession, requireCtx, sessionToken } from "../_lib/session";
import { appUrl } from "@/lib/app-url";

export async function saveSettingsAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    await orgs.updateOrgSettings(ctx, {
      name: str(fd, "name"), address: str(fd, "address"), phone: str(fd, "phone"), contactEmail: str(fd, "contactEmail"),
      brandColour: str(fd, "brandColour"), reporterConfirmation: bool(fd, "reporterConfirmation"), publicReportingEnabled: bool(fd, "publicReportingEnabled"),
    });
    const logo = await fileOf(fd, "logo");
    if (logo) await setOrgLogo(ctx, logo);
    return { ok: "Company settings saved." };
  });
}

export async function saveApprovalRulesAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const approver = str(fd, "approverLimit").trim();
    await orgs.setApprovalRules(await requireCtx(), {
      managerApprovalLimitCents: parseRandToCents(str(fd, "managerLimit") || "0"),
      approverApprovalLimitCents: approver ? parseRandToCents(approver) : null,
      poRequired: bool(fd, "poRequired"),
      multiQuoteThresholdCents: parseRandToCents(str(fd, "quoteThreshold") || "0"),
      minQuotes: Number.parseInt(str(fd, "minQuotes") || "1", 10),
    });
    return { ok: "Approval rules saved." };
  });
}

export async function saveRequisitionAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const next = str(fd, "nextNumber").trim();
    await orgs.setRequisitionSettings(await requireCtx(), {
      referencePrefix: str(fd, "referencePrefix"), nextNumber: next ? Number.parseInt(next, 10) : null, requireSignatures: bool(fd, "requireSignatures"),
    });
    return { ok: "Requisition settings saved." };
  });
}

export async function savePrioritiesAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await orgs.setPriorityRules(await requireCtx(), (["LOW", "NORMAL", "HIGH", "CRITICAL"] as const).map((p) => ({
      priority: p, responseHours: str(fd, `${p}_response`) as unknown as number, completionHours: str(fd, `${p}_completion`) as unknown as number,
    })));
    return { ok: "Response expectations saved." };
  });
}

export async function inviteAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const r = await orgs.inviteMember(await requireCtx(), {
      email: str(fd, "email"), name: str(fd, "name"), roles: list(fd, "roles") as Role[], siteIds: list(fd, "siteIds"),
    });
    // The link is shown once so it can also be shared by WhatsApp; an email is queued as well.
    return { ok: "Invitation created.", data: { link: `${appUrl()}/invite/${r.token}` } };
  });
}

export async function updateMemberAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const r = await orgs.updateMember(await requireCtx(), str(fd, "membershipId"), { roles: list(fd, "roles") as Role[], active: bool(fd, "active"), siteIds: list(fd, "siteIds") });
    return { ok: r.openJobsToReassign ? `${r.name} still leads ${r.openJobsToReassign} open job${r.openJobsToReassign === 1 ? "" : "s"}. Reassign them from the Jobs list (filter by technician).` : "Member updated." };
  });
}

export async function revokeInviteAction(_: ActionState, fd: FormData) {
  return run(async () => { await orgs.revokeInvitation(await requireCtx(), str(fd, "id")); return { ok: "Invitation cancelled." }; });
}

export async function createSiteAction(_: ActionState, fd: FormData) {
  return run(async () => { const st = await sites.createSite(await requireCtx(), { name: str(fd, "name"), address: str(fd, "address") }); return { redirect: `/sites/${st.id}` }; });
}

export async function updateSiteAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await sites.updateSite(await requireCtx(), str(fd, "id"), { name: str(fd, "name"), address: str(fd, "address"), archived: bool(fd, "archived") });
    return bool(fd, "archived") ? { redirect: "/sites" } : { ok: "Site saved." };
  });
}

export async function rotateSiteLinkAction(_: ActionState, fd: FormData) {
  return run(async () => { await sites.rotateSiteToken(await requireCtx(), str(fd, "id")); return { ok: "New report link created. Print new QR codes – the old ones no longer work." }; });
}

export async function createLocationAction(_: ActionState, fd: FormData) {
  return run(async () => { await sites.createLocation(await requireCtx(), { siteId: str(fd, "siteId"), name: str(fd, "name"), foodArea: bool(fd, "foodArea") }); return { ok: "Location added." }; });
}

export async function foodAreaAction(_: ActionState, fd: FormData) {
  return run(async () => { const on = str(fd, "foodArea") === "true"; await sites.setFoodArea(await requireCtx(), str(fd, "id"), on); return { ok: on ? "Marked as a food-handling area." : "No longer a food-handling area." }; });
}

const contractorInput = (fd: FormData) => ({
  name: str(fd, "name"), trade: str(fd, "trade"), contactName: str(fd, "contactName"), email: str(fd, "email"), phone: str(fd, "phone"),
  vatRegistered: bool(fd, "vatRegistered"), vatNumber: str(fd, "vatNumber"), notes: str(fd, "notes"),
});

export async function createContractorAction(_: ActionState, fd: FormData) {
  return run(async () => { const c = await contractors.createContractor(await requireCtx(), contractorInput(fd)); return { redirect: `/contractors/${c.id}` }; });
}

export async function updateContractorAction(_: ActionState, fd: FormData) {
  return run(async () => { await contractors.updateContractor(await requireCtx(), str(fd, "id"), { ...contractorInput(fd), active: !bool(fd, "inactive") }); return { ok: "Contractor saved." }; });
}

export async function createAssetAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const a = await sites.createAsset(await requireCtx(), {
      siteId: str(fd, "siteId"), locationId: str(fd, "locationId") || null, reference: str(fd, "reference"), name: str(fd, "name"), type: str(fd, "type"),
      manufacturer: str(fd, "manufacturer"), model: str(fd, "model"), serialNumber: str(fd, "serialNumber"), notes: str(fd, "notes"),
    });
    return { redirect: `/assets/${a.id}` };
  });
}

export async function grantSupportAction(_: ActionState, fd: FormData) {
  return run(async () => { await orgs.grantSupportAccess(await requireCtx(), { reason: str(fd, "reason"), hours: Number(str(fd, "hours") || 24) }); return { ok: "Support access granted." }; });
}
export async function revokeSupportAction(_: ActionState, fd: FormData) {
  return run(async () => { await orgs.revokeSupportAccess(await requireCtx(), str(fd, "id")); return { ok: "Support access revoked." }; });
}

// ----- Platform operator -----

async function platformUser() {
  const s = await getSession();
  if (!s?.user.isPlatformAdmin) throw forbidden();
  return s.user;
}

export async function setSubscriptionAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const date = (k: string) => (str(fd, k) ? new Date(str(fd, k)) : null);
    await setSubscription(await platformUser(), str(fd, "orgId"), {
      planCode: str(fd, "planCode"), status: str(fd, "status") as SubscriptionStatus,
      currentPeriodEnd: date("currentPeriodEnd"), trialEndsAt: date("trialEndsAt"), graceEndsAt: date("graceEndsAt"),
    });
    return { ok: "Subscription updated." };
  });
}

export async function enterSupportAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const user = await platformUser();
    await orgs.enterSupportSession(user, str(fd, "orgId"));
    await switchWorkspace((await sessionToken())!, str(fd, "orgId"));
    return { redirect: "/dashboard" };
  });
}

export async function createDepartmentAction(_: ActionState, fd: FormData) {
  return run(async () => { await departments.createDepartment(await requireCtx(), { name: str(fd, "name") }); return { ok: "Department added." }; });
}

export async function renameDepartmentAction(_: ActionState, fd: FormData) {
  return run(async () => { await departments.renameDepartment(await requireCtx(), str(fd, "departmentId"), { name: str(fd, "name") }); return { ok: "Department renamed." }; });
}

export async function archiveDepartmentAction(_: ActionState, fd: FormData) {
  return run(async () => { await departments.archiveDepartment(await requireCtx(), str(fd, "departmentId")); return { ok: "Department archived." }; });
}

export async function departmentMemberAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    if (str(fd, "remove") === "1") { await departments.removeDepartmentMember(ctx, str(fd, "departmentId"), str(fd, "userId")); return { ok: "Removed from the department." }; }
    await departments.setDepartmentMember(ctx, str(fd, "departmentId"), { userId: str(fd, "userId"), isManager: bool(fd, "isManager") });
    return { ok: "Department updated." };
  });
}

export async function createJoinCodeAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const c = await registration.createJoinCode(await requireCtx(), { siteId: str(fd, "siteId") || null, days: Number(str(fd, "days") || 30) });
    return { ok: `Registration code ${c.code} created.` };
  });
}

export async function revokeJoinCodeAction(_: ActionState, fd: FormData) {
  return run(async () => { await registration.revokeJoinCode(await requireCtx(), str(fd, "id")); return { ok: "Code switched off." }; });
}

export async function regenerateJoinCodeAction(_: ActionState, fd: FormData) {
  return run(async () => { const c = await registration.regenerateJoinCode(await requireCtx(), str(fd, "id")); return { ok: `Replaced. New code: ${c.code}` }; });
}

export async function approveMemberAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await registration.approveMember(await requireCtx(), str(fd, "membershipId"), {
      roles: list(fd, "roles") as Role[], departmentId: str(fd, "departmentId") || null, departmentManager: bool(fd, "departmentManager"),
    });
    return { ok: "Access approved. They have been emailed." };
  });
}

export async function rejectMemberAction(_: ActionState, fd: FormData) {
  return run(async () => { await registration.rejectMember(await requireCtx(), str(fd, "membershipId"), { reason: str(fd, "reason") }); return { ok: "Request declined." }; });
}
