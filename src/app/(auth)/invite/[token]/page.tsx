import Link from "next/link";
import { acceptInviteAction } from "@/app/actions/auth";
import { Form, Submit } from "@/components/form";
import { Field } from "@/components/ui";
import { getInvitation } from "@/server/services/orgs";

export const metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await getInvitation(token);
  if (!inv)
    return (
      <>
        <h1 className="text-xl font-extrabold">Invitation not valid</h1>
        <p className="muted mt-2">This invitation has expired or was already used. Ask the person who invited you to send a new one.</p>
        <Link className="btn btn-secondary mt-4 w-full" href="/login">Go to sign in</Link>
      </>
    );
  return (
    <>
      <h1 className="text-xl font-extrabold">Join {inv.orgName}</h1>
      <p className="muted mb-4 mt-1">You were invited as <strong>{inv.email}</strong>.</p>
      <Form action={acceptInviteAction} hidden={{ token }}>
        {!inv.hasAccount && <Field label="Your name" name="name" defaultValue={inv.name} autoComplete="name" required />}
        <Field label={inv.hasAccount ? "Your existing FixRelay password" : "Choose a password"} name="password" type="password" minLength={10} required
          autoComplete={inv.hasAccount ? "current-password" : "new-password"} hint={inv.hasAccount ? "You already have an account with this email." : "At least 10 characters."} />
        <Submit className="btn btn-primary w-full">Accept invitation</Submit>
      </Form>
    </>
  );
}
