import { forgotPasswordAction } from "@/app/actions/auth";
import { Form, Submit } from "@/components/form";
import Link from "@/components/link";
import { Field } from "@/components/ui";

export const metadata = { title: "Forgot password" };

export default function ForgotPassword() {
  return (
    <>
      <h1 className="text-xl font-extrabold">Forgot your password?</h1>
      <p className="muted mb-4 mt-1">Enter your email address and we will send you a link to choose a new one.</p>
      <Form action={forgotPasswordAction}>
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Submit className="btn btn-primary w-full">Send reset link</Submit>
      </Form>
      <p className="muted mt-4 text-center"><Link className="link" href="/login">Back to sign in</Link></p>
    </>
  );
}
