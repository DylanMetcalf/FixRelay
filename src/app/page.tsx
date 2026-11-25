import { redirect } from "next/navigation";
import { InstallButton } from "@/components/client";
import Link from "@/components/link";
import { Logo, Mark } from "@/components/logo";
import { getSession } from "./_lib/session";

export const metadata = {
  title: { absolute: "ManOp – From reported to resolved." },
  description: "Maintenance operations: requests, job cards and approvals in one place. ManOp is the maintenance system for your own sites: anyone reports a fault, your team decides in-house or contractor, quotes are compared and approved, and every repair is tracked to the finish.",
};

const PAINS = [
  "Faults reported by WhatsApp, phone calls or shouted across the floor",
  "Nobody sure who is fixing what, or whether it was ever fixed",
  "Contractor quotes lost in email and never properly compared",
  "Spend approved without the right person signing off",
  "Work done without photos or proof",
  "No record of what keeps breaking, or what it costs",
];
const STEPS = [
  { n: "1", t: "Fault reported", d: "Anyone on site scans the QR code on the machine or door, or uses the app. Photos included. No training needed." },
  { n: "2", t: "In-house or contractor?", d: "Your maintenance team assesses it and decides: fix it themselves, or get quotes from contractors." },
  { n: "3", t: "Quotes compared", d: "Contractors quote through a secure link – no account. Quotes line up side by side, cheapest marked." },
  { n: "4", t: "Approved and fixed", d: "Spend is approved by the right person for the amount, with a PO if you need one. The work is done with photo evidence." },
  { n: "5", t: "Confirmed and closed", d: "The person who reported it confirms it's fixed. Every step stays in a permanent history, per site and per machine." },
];
const FEATURES = [
  { t: "For your maintenance team", items: ["One queue for every fault, with a clear owner", "In-house jobs and contractor jobs side by side", "Overdue and unassigned work flagged", "Technicians work from their phones"] },
  { t: "For everyone on site", items: ["Scan a QR code, describe the problem, done", "Optional reporting without an account", "See progress without chasing anyone", "Confirm when it's really fixed"] },
  { t: "For site and finance managers", items: ["Approval limits by amount, PO numbers", "Three-quote rule with recorded exceptions", "Spend per site, per machine, per contractor", "Contractor speed, cost and rework compared"] },
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
            <h1 className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl">From reported to resolved.</h1>
            <p className="mt-4 max-w-xl text-lg text-slate-300">The maintenance system for your own sites. Every fault, contractor quote, approval and repair in one place – for factories, warehouses, retail centres, schools and estates.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/register" className="btn bg-signal px-6 text-base text-navy hover:brightness-105">Start your free 14-day trial</Link>
              <Link href="#how" className="btn border border-navy-3 px-6 text-base text-white hover:bg-navy-2">See how it works</Link>
            </div>
            <p className="mt-3 text-sm text-slate-400">No card needed. Add a site, print QR codes, and start taking fault reports today. Try it with sample data first.</p>
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
        <p className="mx-auto mt-8 max-w-2xl text-center text-lg text-gray-700">ManOp replaces the chasing with one clear process. Every job always shows <strong>what is happening, who is responsible and what happens next.</strong></p>
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
            <h2 className="text-3xl font-extrabold tracking-tight">Made for South African sites</h2>
            <ul className="mt-5 space-y-3 text-slate-200">
              <li>✓ Quotes compared in rand, exact to the cent. VAT added only for VAT-registered contractors.</li>
              <li>✓ Contractors need no account: they get a secure link by email (or WhatsApp).</li>
              <li>✓ Built with POPIA in mind: private files, photo location data removed, access you control.</li>
              <li>✓ Your data stays yours: export everything at any time, even if you stop subscribing.</li>
            </ul>
          </div>
          <div className="rounded-xl bg-navy-2 p-6">
            <h3 className="text-xl font-extrabold">Install it like an app</h3>
            <p className="mt-2 text-slate-300">ManOp runs in the browser and installs on Android, iPhone and desktop – no app store needed. On iPhone: Share → <em>Add to Home Screen</em>.</p>
            <div className="mt-4"><InstallButton /></div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Mark size={64} />
        <h2 className="mt-4 text-3xl font-extrabold tracking-tight">Ready to stop chasing repairs?</h2>
        <p className="mt-3 text-lg text-gray-700">Create your account, add a site, print your QR codes and take your first fault report in minutes.</p>
        <Link href="/register" className="btn btn-primary mt-6 px-8 text-base">Start free trial</Link>
      </section>

      <footer className="border-t border-gray-200 py-8 text-center text-sm text-gray-600">
        © {new Date().getFullYear()} ManOp · <Link className="underline" href="/privacy">Privacy</Link> · <Link className="underline" href="/terms">Terms</Link> · <Link className="underline" href="/login">Sign in</Link>
      </footer>
    </div>
  );
}

function PhoneMock() {
  return (
    <div aria-hidden className="mx-auto w-full max-w-xs rounded-[2.2rem] border-8 border-navy-3 bg-mist p-3 shadow-2xl">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="text-[11px] font-bold text-gray-700">REQ-00128 · Germiston Plant · Cold Room 2</p>
        <p className="mt-1 text-base font-extrabold">Compressor 2 tripping</p>
        <div className="mt-2 flex gap-1.5"><span className="badge bg-amber-100 text-amber-900">Getting quotes</span><span className="badge bg-red-700 text-white">Critical</span></div>
        <div className="mt-3 rounded-lg border border-gray-200 text-xs">
          <div className="flex justify-between border-b border-gray-200 p-2"><span className="font-bold">CoolTech Refrigeration</span><span className="font-bold">R 7 877.50</span></div>
          <div className="flex justify-between p-2 text-gray-700"><span>Sparks Electrical</span><span>R 8 533.00</span></div>
        </div>
        <div className="mt-3 rounded-lg border-l-4 border-relay bg-mist p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-700">What happens next</p>
          <p className="text-sm font-extrabold">Compare quotes and choose one</p>
          <p className="text-xs text-gray-600">Responsible: Maintenance manager</p>
        </div>
                <div className="mt-3 rounded-md bg-relay py-2.5 text-center text-sm font-bold text-white">Approve CoolTech – R 7 877.50</div>
      </div>
      <div className="mt-3 rounded-xl bg-white p-3 shadow-sm">
        <p className="text-xs font-bold text-green-800">✓ Packing hall door confirmed fixed</p>
        <p className="text-[11px] text-gray-700">by the person who reported it · 2 min ago</p>
      </div>
    </div>
  );
}
