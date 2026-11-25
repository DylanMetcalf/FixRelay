import Link from "@/components/link";
import { Logo } from "@/components/logo";
import { Tour } from "@/components/tour";

export const metadata = { title: "How it works", description: "How a maintenance job moves through ManOp: managed by maintenance management, or done start to finish by one person." };

type Stage = { name: string; who: string; add: string };

const MANAGED: Stage[] = [
  { name: "Reported", who: "Anyone on site (app or QR code)", add: "What is wrong, urgency, place, photos, signature" },
  { name: "Screened and sent for assessment", who: "Maintenance manager", add: "Urgency changes, responsible department, duplicate check" },
  { name: "Assessed", who: "Technician or manager", add: "Findings, likely cause, recommended work, spares, contractor needed?" },
  { name: "Quoted and approved (only when needed)", who: "Manager, contractors, approver", add: "Quotes by secure link or email, comparison, approval by amount, PO" },
  { name: "Assigned", who: "Maintenance manager", add: "Technician (or contractor), planned dates, instructions" },
  { name: "Work done", who: "Technician or contractor", add: "Progress notes, time and materials, spares, after photos, root cause" },
  { name: "Confirmed fixed", who: "The person who reported it", add: "Fixed / not fixed, comment, signature" },
  { name: "Closed", who: "Maintenance manager", add: "Sign-off. Completion report and job history ready" },
];

const SELF: Stage[] = [
  { name: "Reported – “I’ll fix it myself”", who: "Technician, manager or other maintenance staff", add: "What is wrong, urgency, place, photos" },
  { name: "In progress straight away", who: "The same person", add: "Assigned to them and started; notes, spares, time" },
  { name: "Work done", who: "The same person", add: "After photos or test document, root cause, signature" },
  { name: "Signed off (if your company asks for it)", who: "Maintenance manager", add: "Check and close – or the job closes on completion" },
];

function Flow({ title, intro, stages, tone }: { title: string; intro: string; stages: Stage[]; tone: "blue" | "green" }) {
  const dot = tone === "blue" ? "bg-blue-700" : "bg-green-700";
  return (
    <section className="rounded-xl border border-gray-300 bg-white p-5" data-testid={`flow-${tone === "blue" ? "managed" : "self"}`}>
      <h2 className="text-xl font-extrabold text-navy">{title}</h2>
      <p className="mt-1 text-sm text-gray-700">{intro}</p>
      <ol className="mt-4 space-y-0">
        {stages.map((s, i) => (
          <li key={s.name} className="relative flex gap-3 pb-4">
            {i < stages.length - 1 && <span aria-hidden className="absolute left-[13px] top-7 h-full w-0.5 bg-gray-300" />}
            <span aria-hidden className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${dot}`}>{i + 1}</span>
            <div>
              <p className="font-bold text-gray-900">{s.name}</p>
              <p className="text-sm text-gray-700"><span className="font-semibold">Who:</span> {s.who}</p>
              <p className="text-sm text-gray-700"><span className="font-semibold">What you add:</span> {s.add}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Public explainer of the two workflows, roles and documents. Also the last stop of the guided tour. */
export default function HowItWorks() {
  return (
    <div className="min-h-dvh bg-mist">
      <header className="bg-navy px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <Link href="/" aria-label="ManOp home"><Logo size={34} /></Link>
          <nav className="flex gap-2 text-sm"><Link href="/demo" className="btn btn-sm bg-signal text-navy">Try the live demo</Link><Link href="/login" className="btn btn-sm text-white">Sign in</Link></nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-3xl font-extrabold text-navy sm:text-4xl">How ManOp works</h1>
          <p className="mt-2 max-w-3xl text-lg text-gray-700">Every maintenance job moves from <strong>reported</strong> to <strong>resolved</strong> in one of two ways. Both are recorded the same way, both show on the dashboard, and both end with a branded job card.</p>
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Flow tone="blue" title="Managed job" stages={MANAGED}
            intro="For anything that needs a decision, money or more than one person. Maintenance management has the overview and moves the job along; every job says what happens next and who is responsible." />
          <Flow tone="green" title="One-person job" stages={SELF}
            intro="For the many small jobs where the person on the spot can just fix it. They choose “I’ll fix it myself” when reporting (or take an existing report). It skips assessment, approval and assignment, but still needs evidence, and managers still see it." />
        </div>
        <section className="rounded-xl border border-gray-300 bg-white p-5">
          <h2 className="text-xl font-extrabold text-navy">Which one should I use?</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 text-sm text-gray-800">
            <div><p className="font-bold">Managed</p><ul className="mt-1 list-disc space-y-1 pl-5"><li>It needs a contractor, a quote or spend approval</li><li>Someone else should decide or schedule it</li><li>It is unsafe, large or affects production</li></ul></div>
            <div><p className="font-bold">One-person</p><ul className="mt-1 list-disc space-y-1 pl-5"><li>You can fix it now with what you have</li><li>No spend approval is needed</li><li>Your company allows one-person jobs (Settings)</li></ul></div>
          </div>
          <p className="mt-3 text-sm text-gray-700">Companies choose in Settings whether one-person jobs are allowed and whether a maintenance manager signs them off before they close.</p>
        </section>
        <section className="grid gap-4 md:grid-cols-3">
          {[
            ["Sites, areas and QR codes", "Each site, area and machine gets its own QR sign. Scanning it opens the report form with the place filled in – no account needed if your company allows it."],
            ["Departments and handovers", "Jobs belong to a department and can be handed over with a reason. Department managers see their own queue."],
            ["Job cards and reports", "Every job is a printable A4 job card with photos; completed jobs get a completion report, and the full history can be exported."],
          ].map(([t, d]) => <div key={t} className="rounded-xl border border-gray-300 bg-white p-4"><p className="font-extrabold text-navy">{t}</p><p className="mt-1 text-sm text-gray-700">{d}</p></div>)}
        </section>
        <div className="rounded-xl bg-navy p-6 text-white">
          <p className="text-xl font-extrabold">See it for yourself</p>
          <p className="mt-1 text-slate-300">Open a private sandbox with sample sites, people and jobs at every stage, and switch between roles.</p>
          <Link href="/demo" className="btn mt-4 bg-signal text-navy">Try the live demo – no sign-up</Link>
        </div>
      </main>
      <Tour />
    </div>
  );
}
