import Link from "@/components/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { getSession } from "@/app/_lib/session";
import { Form, Submit } from "@/components/form";
import { Field } from "@/components/ui";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getSession()) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-4 text-xl font-extrabold">Sign in</h1>
      <Form action={loginAction}>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        <p className="-mt-1 text-right text-sm"><Link className="link" href="/forgot-password">Forgot password?</Link></p>
        <Submit className="btn btn-primary w-full">Sign in</Submit>
      </Form>
      <p className="muted mt-4 text-center">New maintenance company? <Link className="link" href="/register">Create an account</Link></p>
    </>
  );
}
