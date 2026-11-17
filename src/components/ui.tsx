import Link from "@/components/link";
import type { JobStatus, Priority } from "@prisma/client";
import { nextAction, STATUS_LABEL } from "@/server/workflow";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">{title}</h1>
        {subtitle && <p className="muted mt-1">{subtitle}</p>}
      </div>
      {children && <div className="no-print flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Card({ title, children, className = "", aside }: { title?: string; children: React.ReactNode; className?: string; aside?: React.ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || aside) && <div className="mb-3 flex items-center justify-between gap-2">{title && <h2 className="text-base font-bold text-gray-900">{title}</h2>}{aside}</div>}
      {children}
    </section>
  );
}

export function Field({ label, name, hint, children, ...input }: { label: string; name: string; hint?: string; children?: React.ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="label" htmlFor={input.id ?? name}>{label}{input.required && <span className="text-red-700"> *</span>}</label>
      {children ?? <input id={name} name={name} className="input" {...input} />}
      {hint && <p className="mt-1 text-xs text-gray-600">{hint}</p>}
    </div>
  );
}

export function TextArea({ label, name, hint, rows = 3, ...rest }: { label: string; name: string; hint?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Field label={label} name={name} hint={hint} required={rest.required}><textarea id={name} name={name} rows={rows} className="input" {...rest} /></Field>;
}

export function Select({ label, name, options, hint, ...rest }: { label: string; name: string; hint?: string; options: { value: string; label: string }[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} name={name} hint={hint} required={rest.required}>
      <select id={name} name={name} className="input" {...rest}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </Field>
  );
}

export function Check({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  return <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-gray-800"><input type="checkbox" name={name} defaultChecked={defaultChecked} className="h-5 w-5" />{label}</label>;
}

const STATUS_STYLE: Record<JobStatus, string> = {
  NEW: "bg-blue-100 text-blue-900", ASSESSING: "bg-indigo-100 text-indigo-900", ASSESSED: "bg-indigo-100 text-indigo-900",
  QUOTING: "bg-amber-100 text-amber-900", AWAITING_APPROVAL: "bg-amber-200 text-amber-950", APPROVED: "bg-teal-100 text-teal-900",
  ASSIGNED: "bg-cyan-100 text-cyan-900", IN_PROGRESS: "bg-sky-200 text-sky-950", ON_HOLD: "bg-orange-200 text-orange-950",
  AWAITING_VERIFICATION: "bg-purple-100 text-purple-900", VERIFIED: "bg-green-100 text-green-900", CLOSED: "bg-green-700 text-white", CANCELLED: "bg-gray-300 text-gray-800",
};
export const StatusBadge = ({ status }: { status: JobStatus }) => <span className={`badge ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;

const PRIORITY_STYLE: Record<Priority, string> = { LOW: "bg-gray-200 text-gray-800", NORMAL: "bg-gray-200 text-gray-800", HIGH: "bg-orange-200 text-orange-950", CRITICAL: "bg-red-700 text-white" };
export const PriorityBadge = ({ priority, emergency }: { priority: Priority; emergency?: boolean }) => (
  <>
    <span className={`badge ${PRIORITY_STYLE[priority]}`}>{priority[0] + priority.slice(1).toLowerCase()}</span>
    {emergency && <span className="badge ml-1 bg-red-700 text-white">Emergency</span>}
  </>
);

export const Pill = ({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "green" | "red" | "amber" | "blue" }) => {
  const c = { gray: "bg-gray-200 text-gray-800", green: "bg-green-100 text-green-900", red: "bg-red-100 text-red-900", amber: "bg-amber-100 text-amber-900", blue: "bg-blue-100 text-blue-900" }[tone];
  return <span className={`badge ${c}`}>{children}</span>;
};

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-8 text-center"><p className="font-bold text-gray-900">{title}</p>{children && <div className="muted mt-2">{children}</div>}</div>;
}

export const fmtDate = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" }) : "—");
export const fmtDateTime = (d: Date | null | undefined) =>
  d ? d.toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }) : "—";
export const isOverdue = (j: { dueAt: Date | null; status: JobStatus }) => !!j.dueAt && j.dueAt < new Date() && j.status !== "CLOSED" && j.status !== "CANCELLED";

interface Row {
  id: string; reference: string; title: string; status: JobStatus; priority: Priority; emergency: boolean; dueAt: Date | null;
  customerSignoffRequired: boolean; leadTechnicianId: string | null; technicianName: string | null; client: { name: string }; site: { name: string };
}

/** Job list: cards on phones, table on desktop. Each row states the next action and who owns it. */
export function JobList({ jobs, empty }: { jobs: Row[]; empty: React.ReactNode }) {
  if (jobs.length === 0) return <>{empty}</>;
  return (
    <>
      <ul className="space-y-3 md:hidden">
        {jobs.map((j) => {
          const next = nextAction(j);
          return (
            <li key={j.id}>
              <Link href={`/jobs/${j.id}`} className="card block active:bg-gray-50">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs font-bold text-gray-600">{j.reference}</span>
                  <StatusBadge status={j.status} />
                </div>
                <p className="mt-1 font-bold text-gray-900">{j.title}</p>
                <p className="muted">{j.client.name} · {j.site.name}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <PriorityBadge priority={j.priority} emergency={j.emergency} />
                  {isOverdue(j) && <Pill tone="red">Overdue</Pill>}
                </div>
                <p className="mt-2 text-sm"><span className="font-semibold">Next:</span> {next.label} <span className="text-gray-600">({next.party})</span></p>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="card hidden overflow-x-auto p-0 md:block">
        <table className="w-full">
          <thead className="border-b border-gray-300 bg-gray-50"><tr>
            <th className="th">Ref</th><th className="th">Job</th><th className="th">Customer / site</th><th className="th">Status</th>
            <th className="th">Priority</th><th className="th">Next action</th><th className="th">Technician</th><th className="th">Due</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-200">
            {jobs.map((j) => {
              const next = nextAction(j);
              return (
                <tr key={j.id} className="hover:bg-gray-50">
                  <td className="td whitespace-nowrap font-bold"><Link className="link" href={`/jobs/${j.id}`}>{j.reference}</Link></td>
                  <td className="td max-w-xs font-semibold"><Link href={`/jobs/${j.id}`} className="hover:underline">{j.title}</Link></td>
                  <td className="td">{j.client.name}<br /><span className="text-gray-600">{j.site.name}</span></td>
                  <td className="td"><StatusBadge status={j.status} /></td>
                  <td className="td whitespace-nowrap"><PriorityBadge priority={j.priority} emergency={j.emergency} /></td>
                  <td className="td">{next.label}<br /><span className="text-xs font-semibold text-gray-600">{next.party}</span></td>
                  <td className="td">{j.technicianName ?? "—"}</td>
                  <td className="td whitespace-nowrap">{fmtDate(j.dueAt)}{isOverdue(j) && <><br /><Pill tone="red">Overdue</Pill></>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function QuotePill({ status }: { status: string }) {
  const tone = ({ DRAFT: "gray", SUBMITTED: "amber", APPROVED: "green", REJECTED: "red", SUPERSEDED: "gray", WITHDRAWN: "gray" } as const)[status] ?? "gray";
  const label = { DRAFT: "Draft", SUBMITTED: "Awaiting approval", APPROVED: "Approved", REJECTED: "Rejected", SUPERSEDED: "Replaced by newer version", WITHDRAWN: "Withdrawn" }[status] ?? status;
  return <Pill tone={tone}>{label}</Pill>;
}
