import Link from "@/components/link";
import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-navy px-4 py-10">
      <div className="mb-6 text-center">
        <Link href="/" aria-label="ManOp home"><Logo size={44} /></Link>
        <p className="mt-3 max-w-sm text-sm text-slate-300">From reported to resolved. Maintenance operations: requests, job cards and approvals in one place.</p>
      </div>
      <div className="card w-full max-w-md">{children}</div>
      <p className="mt-6 text-xs text-slate-400"><Link href="/privacy" className="underline">Privacy</Link> · <Link href="/terms" className="underline">Terms</Link></p>
    </main>
  );
}
