import Link from "@/components/link";
import { changePasswordAction, switchWorkspaceAction, updateProfileAction } from "@/app/actions/auth";
import { prisma } from "@/lib/db";
import { requireSession } from "@/app/_lib/session";
import { Form, Submit } from "@/components/form";
import { Card, Field, PageHeader } from "@/components/ui";
import { can } from "@/server/permissions";

export const metadata = { title: "Profile" };

export default async function Profile() {
  const s = await requireSession();
  const { ctx } = s;
  const links = [
    { href: "/dashboard", label: "Home", show: true }, { href: "/jobs?view=requests", label: "Reports", show: true }, { href: "/jobs?view=jobs", label: "Jobs", show: true },
    { href: "/quotes", label: "Quotes", show: can(ctx, "quote.view") }, { href: "/sites", label: "Sites", show: can(ctx, "sites.view") },
    { href: "/assets", label: "Equipment", show: can(ctx, "sites.view") }, { href: "/contractors", label: "Contractors", show: can(ctx, "contractors.view") },
    { href: "/reports", label: "Insights", show: can(ctx, "reports.view") },
    { href: "/settings", label: "Settings", show: can(ctx, "team.view") },
  ].filter((l) => l.show);
  const [me, myDepts] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: s.user.id }, select: { jobTitle: true, phone: true, photoKey: true } }),
    prisma.departmentMember.findMany({ where: { orgId: ctx.orgId, userId: s.user.id }, include: { department: { select: { name: true } } } }),
  ]);
  return (
    <>
      <PageHeader title={s.user.name} subtitle={`${s.user.email} · ${s.org.name} · ${ctx.support ? "support" : ctx.roles.join(", ").toLowerCase()}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Go to" className="md:hidden">
          <div className="grid grid-cols-2 gap-2">{links.map((l) => <Link key={l.href} href={l.href} className="btn btn-secondary">{l.label}</Link>)}</div>
        </Card>
        {!ctx.support && (
          <Card title="Your details">
            <div className="mb-3 flex items-center gap-3">
              {me.photoKey
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={`/api/avatar/${s.user.id}`} alt="Your profile photo" className="h-14 w-14 rounded-full object-cover" />
                : <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-200 text-xl font-bold">{s.user.name.slice(0, 1)}</span>}
              <p className="text-sm">{myDepts.length ? <>Department: <strong>{myDepts.map((d) => `${d.department.name}${d.isManager ? " (manager)" : ""}`).join(", ")}</strong></> : "No department"}</p>
            </div>
            <Form action={updateProfileAction}>
              <Field label="Name" name="name" required defaultValue={s.user.name} autoComplete="name" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Job title" name="jobTitle" defaultValue={me.jobTitle} maxLength={80} />
                <Field label="Phone" name="phone" type="tel" defaultValue={me.phone} maxLength={40} />
              </div>
              <Field label="Profile photo" name="photo"><input id="photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="input" /></Field>
              <Submit className="btn btn-secondary">Save my details</Submit>
            </Form>
          </Card>
        )}
        {s.workspaces.length > 1 && (
          <Card title="Workspace">
            <Form action={switchWorkspaceAction}>
              <select name="orgId" defaultValue={s.org.id} aria-label="Workspace" className="input">{s.workspaces.map((w) => <option key={w.orgId} value={w.orgId}>{w.name}</option>)}</select>
              <Submit className="btn btn-secondary">Switch workspace</Submit>
            </Form>
          </Card>
        )}
        {s.user.isPlatformAdmin && <Card title="Platform"><Form action={switchWorkspaceAction} hidden={{ orgId: "" }}><Submit className="btn btn-secondary">Back to platform console</Submit></Form></Card>}
        {!ctx.support && (
          <Card title="Change password">
            <Form action={changePasswordAction}>
              <Field label="Current password" name="current" type="password" autoComplete="current-password" required />
              <Field label="New password" name="next" type="password" autoComplete="new-password" minLength={10} required hint="At least 10 characters. Other devices will be signed out." />
              <Submit>Change password</Submit>
            </Form>
          </Card>
        )}
        <Card title="Install the app">
          <p className="muted">On your phone, open your browser menu and choose <strong>Add to Home Screen</strong> (or <strong>Install app</strong>). ManOp then opens like an app. It still needs a connection to load and save work.</p>
        </Card>
        <Card><form method="post" action="/api/logout"><button className="btn btn-secondary w-full">Sign out</button></form></Card>
      </div>
    </>
  );
}
