"use server";
import type { Role, SubscriptionStatus } from "@prisma/client";
import { forbidden } from "@/lib/errors";
import { switchWorkspace } from "@/server/auth";
import { setOrgLogo } from "@/server/services/attachments";
import { setSubscription } from "@/server/services/billing";
import * as clients from "@/server/services/clients";
import * as orgs from "@/server/services/orgs";
import { type ActionState, bool, fileOf, list, run, str } from "../_lib/action";
import { getSession, requireCtx, sessionToken } from "../_lib/session";

export async function saveSettingsAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const ctx = await requireCtx();
    await orgs.updateOrgSettings(ctx, {
      name: str(fd, "name"), address: str(fd, "address"), phone: str(fd, "phone"), contactEmail: str(fd, "contactEmail"),
      brandColour: str(fd, "brandColour"), vatRegistered: bool(fd, "vatRegistered"), vatNumber: str(fd, "vatNumber"),
      vatRatePercent: str(fd, "vatRatePercent") as unknown as number, quoteTerms: str(fd, "quoteTerms"),
      quoteValidityDays: str(fd, "quoteValidityDays") as unknown as number, customerSignoffRequired: bool(fd, "customerSignoffRequired"),
    });
    const logo = await fileOf(fd, "logo");
    if (logo) await setOrgLogo(ctx, logo);
    return { ok: "Company settings saved." };
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
      email: str(fd, "email"), name: str(fd, "name"), roles: list(fd, "roles") as Role[], clientId: str(fd, "clientId") || null,
    });
    // The link is shown once so it can also be shared by WhatsApp; an email is queued as well.
    return { ok: "Invitation created.", data: { link: `${process.env.APP_URL ?? ""}/invite/${r.token}` } };
  });
}

export async function updateMemberAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await orgs.updateMember(await requireCtx(), str(fd, "membershipId"), { roles: list(fd, "roles") as Role[], active: bool(fd, "active") });
    return { ok: "Member updated." };
  });
}

export async function revokeInviteAction(_: ActionState, fd: FormData) {
  return run(async () => { await orgs.revokeInvitation(await requireCtx(), str(fd, "id")); return { ok: "Invitation cancelled." }; });
}

export async function createClientAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const c = await clients.createClient(await requireCtx(), { name: str(fd, "name"), contactName: str(fd, "contactName"), email: str(fd, "email"), phone: str(fd, "phone"), notes: str(fd, "notes") });
    return { redirect: `/customers/${c.id}` };
  });
}

export async function updateClientAction(_: ActionState, fd: FormData) {
  return run(async () => {
    await clients.updateClient(await requireCtx(), str(fd, "id"), { name: str(fd, "name"), contactName: str(fd, "contactName"), email: str(fd, "email"), phone: str(fd, "phone"), notes: str(fd, "notes"), archived: bool(fd, "archived") });
    return bool(fd, "archived") ? { redirect: "/customers" } : { ok: "Customer saved." };
  });
}

export async function createSiteAction(_: ActionState, fd: FormData) {
  return run(async () => { await clients.createSite(await requireCtx(), { clientId: str(fd, "clientId"), name: str(fd, "name"), address: str(fd, "address") }); return { ok: "Site added." }; });
}

export async function createLocationAction(_: ActionState, fd: FormData) {
  return run(async () => { await clients.createLocation(await requireCtx(), { siteId: str(fd, "siteId"), name: str(fd, "name") }); return { ok: "Location added." }; });
}

export async function createAssetAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const a = await clients.createAsset(await requireCtx(), {
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
