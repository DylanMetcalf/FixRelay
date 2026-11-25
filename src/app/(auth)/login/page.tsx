import Link from "@/components/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { loginAction } from "@/app/actions/auth";
import { getSession } from "@/app/_lib/session";
import { PasswordField } from "@/components/client";
import { Form, Submit } from "@/components/form";
import { Field } from "@/components/ui";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const s = await getSession();
  // Already signed in: go to the right home. Not while re-rendering for the sign-in action itself – the action's
  // result decides where to go (a redirect thrown here would race it and leave the browser on a blank page).
  const duringAction = !!(await headers()).get("next-action");
  if (s && !duringAction) redirect(!s.ctx ? (s.user.isPlatformAdmin ? "/platform" : "/no-access") : next && /^\/(?!\/)/.test(next) ? next : "/dashboard");
  return (
    <>
      <h1 className="mb-4 text-xl font-extrabold">Sign in</h1>
      {next?.startsWith("/requests/new") && <p className="mb-3 rounded-md bg-blue-50 p-3 text-sm">Sign in to report this fault. Your site and location are already filled in.</p>}
      <Form action={loginAction} hidden={{ next: next ?? "" }}>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <PasswordField label="Password" name="password" autoComplete="current-password" />
        <p className="-mt-1 text-right text-sm"><Link className="link" href="/forgot-password">Forgot password?</Link></p>
        <Submit className="btn btn-primary w-full">Sign in</Submit>
      </Form>
      <p className="muted mt-4 text-center">Have a registration code from your site? <Link className="link" href="/join">Join your company</Link></p>
      <p className="muted mt-1 text-center">New company? <Link className="link" href="/register">Start a free trial</Link> or <Link className="link" href="/demo">try the live demo</Link></p>
    </>
  );
}
