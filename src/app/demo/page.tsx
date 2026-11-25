import { headers } from "next/headers";
import { startSandboxAction } from "@/app/actions/auth";
import { getSession } from "@/app/_lib/session";
import { Form, Submit } from "@/components/form";
import Link from "@/components/link";
import { Logo } from "@/components/logo";

export const metadata = { title: "Try the live demo", description: "Open your own ManOp sandbox with sample sites, people and jobs. No sign-up." };
export const dynamic = "force-dynamic";

const ROLES = [
  ["Site administrator", "Sets up sites, areas, QR codes, departments and the team"],
  ["Maintenance manager", "Triage, assessment, quotes, assigning work, sign-off"],
  ["Technician", "Does the work on a phone, with photos and evidence"],
  ["Finance approver", "Approves spend above the manager's limit"],
  ["Operations manager", "A department manager who hands work over"],
  ["Operator", "Reports faults and confirms they are fixed"],
];

/** Public sandbox entry: one click, a private demo company, a guided tour. */
export default async function DemoPage() {
  const s = await getSession();
  // While re-rendering for the "Open my sandbox" action the new guest cookie is already set: keep the form mounted
  // so it can follow the action's redirect (otherwise the "signed in" view would replace it mid-flight).
  const duringAction = !!(await headers()).get("next-action");
  const signedIn = !!s?.ctx && !s.ctx.support && !duringAction;
  return (
    <main className="min-h-dvh bg-navy text-white">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/" aria-label="ManOp home"><Logo size={40} /></Link>
        <h1 className="mt-10 text-4xl font-extrabold leading-tight sm:text-5xl">See ManOp working, <span className="text-signal">right now.</span></h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-300">Open your own private sandbox: a sample company with two sites, departments, people in every role and jobs at every stage – from a fresh QR report to a closed job with its job card. A short tour shows you around. No sign-up, nothing is emailed, and it disappears after 24 hours.</p>
        <div className="mt-8 rounded-xl bg-white p-6 text-gray-900" data-testid="sandbox-card">
          {signedIn ? (
            <>
              <p className="font-bold">You are signed in to {s!.org?.name}.</p>
              <p className="mt-1 text-sm text-gray-700">Opening a sandbox here would sign you out. From your dashboard, use <strong>Explore a demo workspace</strong> instead: it keeps your account and adds a separate demo company.</p>
              <Link href="/dashboard" className="btn btn-primary mt-4">Go to my dashboard</Link>
            </>
          ) : (
            <Form action={startSandboxAction}>
              <Submit className="btn btn-primary w-full text-lg">Open my sandbox</Submit>
              <p className="text-center text-sm text-gray-600">Takes about 10 seconds while the sample data is built.</p>
            </Form>
          )}
        </div>
        <h2 className="mt-10 text-xl font-extrabold">Switch between roles inside the sandbox</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {ROLES.map(([r, d]) => <li key={r} className="rounded-lg bg-navy-2 p-3"><p className="font-bold text-signal">{r}</p><p className="text-sm text-slate-300">{d}</p></li>)}
        </ul>
        <p className="mt-8 text-sm text-slate-400">Ready for your own company? <Link className="underline" href="/register">Start a free trial</Link> · <Link className="underline" href="/how-it-works">How ManOp works</Link> · <Link className="underline" href="/login">Sign in</Link></p>
      </div>
    </main>
  );
}
