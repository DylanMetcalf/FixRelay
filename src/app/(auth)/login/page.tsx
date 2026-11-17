import Link from "@/components/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { getSession } from "@/app/_lib/session";
import { PasswordField } from "@/components/client";
import { Form, Submit } from "@/components/form";
import { Field } from "@/components/ui";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getSession()) redirect(next && /^\/(?!\/)/.test(next) ? next : "/dashboard");
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
      <p className="muted mt-4 text-center">New maintenance company? <Link className="link" href="/register">Create an account</Link></p>
    </>
  );
}
