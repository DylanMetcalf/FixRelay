import { resetPasswordAction } from "@/app/actions/auth";
import { Form, Submit } from "@/components/form";
import Link from "@/components/link";
import { Field } from "@/components/ui";
import { isResetTokenValid } from "@/server/services/account";

export const metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPassword({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await isResetTokenValid(token)))
    return (
      <>
        <h1 className="text-xl font-extrabold">This link has expired</h1>
        <p className="muted mt-2">Reset links work once and expire after an hour. Ask for a new one.</p>
        <Link className="btn btn-primary mt-4 w-full" href="/forgot-password">Send a new link</Link>
      </>
    );
  return (
    <>
      <h1 className="text-xl font-extrabold">Choose a new password</h1>
      <p className="muted mb-4 mt-1">You will be signed out on all other devices.</p>
      <Form action={resetPasswordAction} hidden={{ token }}>
        <Field label="New password" name="password" type="password" autoComplete="new-password" minLength={10} required hint="At least 10 characters. A short sentence is easy to remember." />
        <Field label="Repeat new password" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
        <Submit className="btn btn-primary w-full">Save password and sign in</Submit>
      </Form>
    </>
  );
}
