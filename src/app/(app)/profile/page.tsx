import Link from "@/components/link";
import { changePasswordAction, switchWorkspaceAction } from "@/app/actions/auth";
import { requireSession } from "@/app/_lib/session";
import { Form, Submit } from "@/components/form";
import { Card, Field, PageHeader } from "@/components/ui";
import { can } from "@/server/permissions";

export const metadata = { title: "Profile" };

export default async function Profile() {
  const s = await requireSession();
  const { ctx } = s;
  const links = [
    { href: "/dashboard", label: "Dashboard", show: true }, { href: "/jobs?view=requests", label: "Requests", show: true }, { href: "/jobs?view=jobs", label: "Jobs", show: true },
    { href: "/quotes", label: "Quotes", show: can(ctx, "quote.view") }, { href: "/customers", label: "Customers", show: can(ctx, "clients.view") },
    { href: "/assets", label: "Assets", show: can(ctx, "clients.view") }, { href: "/reports", label: "Reports", show: can(ctx, "reports.view") },
    { href: "/settings", label: "Settings", show: can(ctx, "team.view") },
  ].filter((l) => l.show);
  return (
    <>
      <PageHeader title={s.user.name} subtitle={`${s.user.email} · ${s.org.name} · ${ctx.support ? "support" : ctx.roles.join(", ").toLowerCase()}`} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Go to" className="md:hidden">
          <div className="grid grid-cols-2 gap-2">{links.map((l) => <Link key={l.href} href={l.href} className="btn btn-secondary">{l.label}</Link>)}</div>
        </Card>
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
          <p className="muted">On your phone, open your browser menu and choose <strong>Add to Home Screen</strong> (or <strong>Install app</strong>). FixRelay then opens like an app. It still needs a connection to load and save work.</p>
        </Card>
        <Card><form method="post" action="/api/logout"><button className="btn btn-secondary w-full">Sign out</button></form></Card>
      </div>
    </>
  );
}
