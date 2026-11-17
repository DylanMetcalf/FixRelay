import Link from "@/components/link";
import { registerAction } from "@/app/actions/auth";
import { PasswordField } from "@/components/client";
import { Form, Submit } from "@/components/form";
import { Field } from "@/components/ui";

export const metadata = { title: "Create your company account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-xl font-extrabold">Create your company account</h1>
      <p className="muted mb-4 mt-1">Free trial. No card needed. Set up in a few minutes.</p>
      <Form action={registerAction}>
        <Field label="Company name" name="companyName" autoComplete="organization" required />
        <Field label="Your name" name="name" autoComplete="name" required />
        <Field label="Work email" name="email" type="email" autoComplete="email" required />
        <PasswordField label="Password" name="password" autoComplete="new-password" minLength={10} hint="At least 10 characters. A short sentence is easy to remember." />
        <Submit className="btn btn-primary w-full">Create account</Submit>
      </Form>
      <p className="muted mt-4 text-center">Already registered? <Link className="link" href="/login">Sign in</Link></p>
    </>
  );
}
