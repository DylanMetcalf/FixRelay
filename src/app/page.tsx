import { redirect } from "next/navigation";
import { InstallButton } from "@/components/client";
import Link from "@/components/link";
import { Logo, Mark } from "@/components/logo";
import { getSession } from "./_lib/session";

export const metadata = {
  title: { absolute: "FixRelay – maintenance jobs from fault to sign-off" },
  description: "FixRelay helps maintenance contractors log faults, send quotes for approval, dispatch technicians, capture photo evidence and get customer sign-off – in one simple app.",
};

const PAINS = [
  "Requests lost in WhatsApp, phone calls and email",
  "Quotes forgotten or never followed up",
  "No one sure who is responsible for a job",
  "Technicians not updating progress",
  "Work done without photos or proof",
  "Customers phoning to ask “what’s the status?”",
];
const STEPS = [
  { n: "1", t: "Fault reported", d: "Your team or your customer logs it in seconds, with photos. It lands in one queue with a clear owner." },
  { n: "2", t: "Assess and quote", d: "A technician records findings. You build an accurate quote in rand, with or without VAT." },
  { n: "3", t: "Customer approves", d: "They get a secure link – no account, no app to install – and approve or reject on their phone." },
  { n: "4", t: "Fixed, with proof", d: "Technicians work from their phone: updates, labour, materials, before-and-after photos." },
  { n: "5", t: "Signed off and closed", d: "The customer signs on screen or by link. Every step is in a permanent history and a printable report." },
];
const FEATURES = [
  { t: "For managers", items: ["Live dashboard of every stage", "Overdue and unassigned work flagged", "Quote versions kept, never overwritten", "Reports with plain-English definitions"] },
  { t: "For technicians", items: ["“My jobs” list on their phone", "Big, clear buttons and simple steps", "Camera upload straight from the job", "Customer signs on the device"] },
  { t: "For your customers", items: ["Approve quotes without an account", "See status without phoning you", "Sign off finished work", "Branded with your logo and colours"] },
];

export default async function Landing() {
  if (await getSession()) redirect("/dashboard");
  return (
    <div className="bg-white text-gray-900">
      <header className="bg-navy">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4">
          <Logo size={36} />
          <nav className="flex items-center gap-2 text-sm">
            <Link href="/login" className="btn !min-h-10 !px-3 text-white hover:bg-navy-2">Sign in</Link>
            <Link href="/register" className="btn !min-h-10 bg-signal !px-4 text-navy hover:brightness-105">Start free trial</Link>
          </nav>
        </div>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-8 md:grid-cols-2 md:pt-14">
          <div>
            <p className="mb-3 inline-block rounded-full bg-navy-2 px-3 py-1 text-xs font-bold uppercase tracking-wider text-signal">Maintenance job management</p>
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">From fault reported to job completed.</h1>
            <p className="mt-4 max-w-xl text-lg text-slate-300">Every request, quote, approval and repair in one place. Built for maintenance contractors who look after many customers and sites.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/register" className="btn bg-signal px-6 text-base text-navy hover:brightness-105">Start your free 14-day trial</Link>
              <Link href="#how" className="btn border border-navy-3 px-6 text-base text-white hover:bg-navy-2">See how it works</Link>
            </div>
            <p className="mt-3 text-sm text-slate-400">No card needed. Set up in about five minutes. Try it with sample data first.</p>
          </div>
          <PhoneMock />
        </section>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-extrabold tracking-tight">Sound familiar?</h2>
        <ul className="mx-auto mt-8 grid max-w-4xl gap-3 sm:grid-cols-2">
          {PAINS.map((p) => (
            <li key={p} className="flex items-start gap-3 rounded-lg border border-gray-200 bg-mist p-4 text-base">
              <span aria-hidden className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700">✕</span>{p}
            </li>
          ))}
        </ul>
        <p className="mx-auto mt-8 max-w-2xl text-center text-lg text-gray-700">FixRelay replaces the chasing with one clear workflow. Every job always shows <strong>what is happening, who is responsible and what happens next.</strong></p>
      </section>

      <section id="how" className="bg-mist py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-extrabold tracking-tight">How it works</h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-5">
            {STEPS.map((s) => (
              <li key={s.n} className="rounded-xl bg-white p-5 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-base font-extrabold text-signal">{s.n}</span>
                <h3 className="mt-3 text-lg font-extrabold">{s.t}</h3>
                <p className="mt-1 text-sm text-gray-700">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center text-3xl font-extrabold tracking-tight">Everyone gets exactly what they need</h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.t} className="rounded-xl border border-gray-200 p-6">
              <h3 className="text-xl font-extrabold">{f.t}</h3>
              <ul className="mt-4 space-y-2">{f.items.map((i) => <li key={i} className="flex gap-2 text-base"><span aria-hidden className="font-bold text-relay">✓</span>{i}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-navy py-16 text-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight">Made for South African contractors</h2>
            <ul className="mt-5 space-y-3 text-slate-200">
              <li>✓ Quotes in rand, exact to the cent. VAT only if you are registered.</li>
              <li>✓ Share approval links by email or WhatsApp.</li>
              <li>✓ Built with POPIA in mind: private files, photo location data removed, access you control.</li>
              <li>✓ Your data stays yours: export everything at any time, even if you stop subscribing.</li>
            </ul>
          </div>
          <div className="rounded-xl bg-navy-2 p-6">
            <h3 className="text-xl font-extrabold">Install it like an app</h3>
            <p className="mt-2 text-slate-300">FixRelay runs in the browser and installs on Android, iPhone and desktop – no app store needed. On iPhone: Share → <em>Add to Home Screen</em>.</p>
            <div className="mt-4"><InstallButton /></div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Mark size={64} />
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight">Ready to stop chasing jobs?</h2>
        <p className="mt-3 text-lg text-gray-700">Create your company, add a customer and log your first request in minutes.</p>
        <Link href="/register" className="btn btn-primary mt-6 px-8 text-base">Start free trial</Link>
      </section>

      <footer className="border-t border-gray-200 py-8 text-center text-sm text-gray-600">
        © {new Date().getFullYear()} FixRelay · <Link className="underline" href="/privacy">Privacy</Link> · <Link className="underline" href="/terms">Terms</Link> · <Link className="underline" href="/login">Sign in</Link>
      </footer>
    </div>
  );
}

function PhoneMock() {
  return (
    <div aria-hidden className="mx-auto w-full max-w-xs rounded-[2.2rem] border-8 border-navy-3 bg-mist p-3 shadow-2xl">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="text-[11px] font-bold text-gray-500">REQ-00128 · Karoo Cold Storage</p>
        <p className="mt-1 text-base font-extrabold">Compressor 2 tripping</p>
        <div className="mt-2 flex gap-1.5"><span className="badge bg-sky-200 text-sky-950">In progress</span><span className="badge bg-red-700 text-white">Critical</span></div>
        <div className="mt-3 rounded-lg border-l-4 border-relay bg-mist p-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">What happens next</p>
          <p className="text-sm font-extrabold">Complete the work and submit evidence</p>
          <p className="text-xs text-gray-600">Responsible: Technician – Sipho M.</p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">{["#cbd5e1", "#94a3b8", "#e2e8f0"].map((c) => <div key={c} className="aspect-square rounded-md" style={{ background: c }} />)}</div>
        <div className="mt-3 rounded-md bg-relay py-2.5 text-center text-sm font-bold text-white">Submit for verification</div>
      </div>
      <div className="mt-3 rounded-xl bg-white p-3 shadow-sm">
        <p className="text-xs font-bold text-green-800">✓ Quote Q-00041 approved by customer</p>
        <p className="text-[11px] text-gray-500">via secure link · 2 min ago</p>
      </div>
    </div>
  );
}
