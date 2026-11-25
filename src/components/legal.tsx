import Link from "@/components/link";
import { Logo } from "@/components/logo";

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-mist">
      <header className="bg-navy px-4 py-4"><div className="mx-auto max-w-3xl"><Link href="/" aria-label="ManOp home"><Logo size={32} /></Link></div></header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <article className="card space-y-4 text-[15px] leading-relaxed [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-extrabold [&_ul]:list-disc [&_ul]:pl-6">
          <h1 className="text-2xl font-extrabold">{title}</h1>
          <p className="muted">Last updated {updated}.</p>
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"><strong>Template – have it reviewed.</strong> This text describes how the software actually handles data. It must be reviewed by a South African legal adviser and completed with your company details before you rely on it.</p>
          {children}
        </article>
      </main>
    </div>
  );
}
