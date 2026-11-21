import { redirect } from "next/navigation";
import { resendVerificationAction } from "@/app/actions/auth";
import { getSession } from "@/app/_lib/session";
import { ActionButton } from "@/components/form";
import { Logo } from "@/components/logo";
import { myPendingRequest } from "@/server/services/registration";

export const metadata = { title: "Waiting for access" };
export const dynamic = "force-dynamic";

/** Signed in but without an active company: waiting for approval, or access removed. */
export default async function NoAccess() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.ctx) redirect("/dashboard");
  const pending = await myPendingRequest(s.user.id);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-navy p-4">
      <Logo size={40} />
      <div className="card max-w-md text-center" data-testid={pending ? "pending-approval" : "no-access"}>
        {pending ? (
          <>
            <h1 className="text-xl font-extrabold">Waiting for approval</h1>
            <p className="mt-2">Your request to join <strong>{pending.orgName}</strong> was sent to the site administrator.</p>
            <ol className="mt-4 space-y-2 text-left text-sm">
              <li className="flex gap-2"><span aria-hidden className={pending.emailVerified ? "text-green-700" : "text-amber-700"}>{pending.emailVerified ? "✓" : "1."}</span>
                <span>{pending.emailVerified ? "Email address confirmed." : <>Confirm your email address: open the link we sent to <strong>{pending.email}</strong>.</>}</span></li>
              <li className="flex gap-2"><span aria-hidden>{pending.emailVerified ? "2." : "2."}</span><span>Your administrator approves your access and chooses your role. We email you when it is done.</span></li>
            </ol>
            {!pending.emailVerified && <ActionButton action={resendVerificationAction} hidden={{}} className="btn btn-secondary btn-sm mt-4">Resend the confirmation email</ActionButton>}
          </>
        ) : (
          <>
            <h1 className="text-xl font-extrabold">No company access</h1>
            <p className="muted mt-2">Your account is not linked to an active company. If your access was removed or your request was declined, contact your company administrator.</p>
          </>
        )}
        <form method="post" action="/api/logout"><button className="btn btn-secondary mt-4">Sign out</button></form>
      </div>
    </main>
  );
}
