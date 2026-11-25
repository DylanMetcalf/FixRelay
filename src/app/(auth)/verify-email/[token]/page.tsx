import Link from "@/components/link";
import { verifyEmail } from "@/server/services/account";

export const metadata = { title: "Confirm email", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function VerifyEmail({ params }: { params: Promise<{ token: string }> }) {
  const ok = await verifyEmail((await params).token);
  return ok ? (
    <>
      <h1 className="text-xl font-extrabold" data-testid="verified">Email address confirmed</h1>
      <p className="muted mt-2">Thank you. If you are waiting for approval, your administrator can now approve your access.</p>
      <Link className="btn btn-primary mt-4 w-full" href="/dashboard">Continue to ManOp</Link>
    </>
  ) : (
    <>
      <h1 className="text-xl font-extrabold">This link is no longer valid</h1>
      <p className="muted mt-2">It may have expired or been used already. Sign in and use “Resend link” at the top of the page.</p>
      <Link className="btn btn-primary mt-4 w-full" href="/login">Sign in</Link>
    </>
  );
}
