import Link from "@/components/link";
import type { JobRoute, JobStatus, Priority } from "@prisma/client";
import { nextAction, PRIORITY_LABEL, STATUS_LABEL } from "@/server/workflow";

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
  return <Field label={label} name={name} id={rest.id} hint={hint} required={rest.required}><textarea id={name} name={name} rows={rows} className="input" {...rest} /></Field>;
}

export function Select({ label, name, options, hint, ...rest }: { label: string; name: string; hint?: string; options: { value: string; label: string }[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} name={name} id={rest.id} hint={hint} required={rest.required}>
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

const PRIORITY_STYLE: Record<Priority, string> = { LOW: "bg-gray-200 text-gray-800", NORMAL: "bg-blue-100 text-blue-900", HIGH: "bg-orange-200 text-orange-950", CRITICAL: "bg-red-700 text-white" };
export const PriorityBadge = ({ priority, emergency }: { priority: Priority; emergency?: boolean }) => (
  <>
    <span className={`badge ${PRIORITY_STYLE[priority]}`}>{PRIORITY_LABEL[priority]}</span>
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
  reporterConfirmation: boolean; leadTechnicianId: string | null; technicianName: string | null; route: JobRoute; source: string;
  contractorId: string | null; contractor: { name: string } | null; site: { name: string }; location: { name: string } | null;
  photoId?: string | null; mode?: "MANAGED" | "SELF"; sparesStatus?: "NOT_NEEDED" | "ON_HAND" | "TO_BUY" | "ORDERED" | "READY"; closedAt?: Date | null;
}
const who = (j: Row) => (j.route === "CONTRACTOR" ? (j.contractor?.name ?? "Contractor (quoting)") : (j.technicianName ?? "—"));

const sparesWaiting = (j: Row) => !!j.sparesStatus && ["ON_HAND", "TO_BUY", "ORDERED"].includes(j.sparesStatus) && j.status !== "CLOSED" && j.status !== "CANCELLED";

/** The first photo of the reported problem, or a plain placeholder. */
function JobThumb({ id, small }: { id?: string | null; small?: boolean }) {
  const size = small ? "h-12 w-12" : "h-16 w-16";
  if (!id) return <div aria-hidden className={`${size} flex shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-400`}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/files/${id}`} alt="Photo of the problem" loading="lazy" className={`${size} shrink-0 rounded-md border border-gray-300 object-cover`} data-testid="job-photo" />;
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
              <Link href={`/jobs/${j.id}`} className="card block active:bg-gray-50" data-testid="job-card">
                <div className="flex gap-3">
                  <JobThumb id={j.photoId} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold text-gray-600">{j.reference}</span>
                      <StatusBadge status={j.status} />
                    </div>
                    <p className="mt-1 font-bold text-gray-900">{j.title}</p>
                    <p className="muted">{j.site.name}{j.location && ` · ${j.location.name}`}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <PriorityBadge priority={j.priority} emergency={j.emergency} />
                  {isOverdue(j) && <Pill tone="red">Overdue</Pill>}
                  {j.source === "PUBLIC_LINK" && j.status === "NEW" && <Pill tone="amber">To screen</Pill>}
                  {j.route === "CONTRACTOR" && <Pill tone="blue">Contractor</Pill>}
                  {sparesWaiting(j) && <Pill tone="amber">Waiting for spares</Pill>}
                  {j.mode === "SELF" && <Pill tone="green">One-person</Pill>}
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
            <th className="th"><span className="sr-only">Photo</span></th><th className="th">Ref</th><th className="th">Job</th><th className="th">Site / location</th><th className="th">Status</th>
            <th className="th">Priority</th><th className="th">Next action</th><th className="th">Fixed by</th><th className="th">Due</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-200">
            {jobs.map((j) => {
              const next = nextAction(j);
              return (
                <tr key={j.id} className="hover:bg-gray-50">
                  <td className="td !py-2"><Link href={`/jobs/${j.id}`} tabIndex={-1} aria-hidden><JobThumb id={j.photoId} small /></Link></td>
                  <td className="td whitespace-nowrap font-bold"><Link className="link" href={`/jobs/${j.id}`}>{j.reference}</Link></td>
                  <td className="td max-w-xs font-semibold"><Link href={`/jobs/${j.id}`} className="hover:underline">{j.title}</Link></td>
                  <td className="td">{j.site.name}<br /><span className="text-gray-600">{j.location?.name ?? ""}</span>{j.source === "PUBLIC_LINK" && j.status === "NEW" && <><br /><Pill tone="amber">To screen</Pill></>}</td>
                  <td className="td"><StatusBadge status={j.status} /></td>
                  <td className="td whitespace-nowrap"><PriorityBadge priority={j.priority} emergency={j.emergency} />{sparesWaiting(j) && <><br /><Pill tone="amber">Waiting for spares</Pill></>}{j.mode === "SELF" && <><br /><Pill tone="green">One-person</Pill></>}</td>
                  <td className="td">{next.label}<br /><span className="text-xs font-semibold text-gray-600">{next.party}</span></td>
                  <td className="td">{who(j)}</td>
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
  const label = { DRAFT: "Draft", SUBMITTED: "Received – open", APPROVED: "Accepted", REJECTED: "Not selected", SUPERSEDED: "Replaced by a newer version", WITHDRAWN: "Withdrawn" }[status] ?? status;
  return <Pill tone={tone}>{label}</Pill>;
}
