export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-slate-900 px-4 py-10">
      <div className="mb-6 text-center">
        <p className="text-3xl font-extrabold tracking-tight text-white">Fix<span className="text-amber-400">Relay</span></p>
        <p className="mt-2 max-w-sm text-sm text-slate-300">From fault reported to job completed. Every request, quote, approval and repair in one place.</p>
      </div>
      <div className="card w-full max-w-md">{children}</div>
    </main>
  );
}
