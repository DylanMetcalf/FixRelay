import { notFound } from "next/navigation";
import { updateContractorAction } from "@/app/actions/admin";
import { requirePage } from "@/app/_lib/session";
import { ContractorFields } from "@/components/contractor-fields";
import { Form, Submit } from "@/components/form";
import Link from "@/components/link";
import { Card, PageHeader, QuotePill, StatusBadge } from "@/components/ui";
import { AppError } from "@/lib/errors";
import { formatZar } from "@/lib/money";
import { can } from "@/server/permissions";
import { getContractor } from "@/server/services/contractors";

export const metadata = { title: "Contractor" };

export default async function ContractorPage({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requirePage("contractors.view");
  const c = await getContractor(ctx, (await params).id).catch((e) => { if (e instanceof AppError) notFound(); throw e; });
  const won = c.quotes.filter((q) => q.status === "APPROVED").length;
  const decided = c.quotes.filter((q) => q.status === "APPROVED" || q.status === "REJECTED").length;
  const spend = c.jobs.reduce((t, j) => t + (j.approvedCostCents ?? 0), 0);
  return (
    <>
      <PageHeader title={c.name} subtitle={<>{c.trade}{c.contactName && ` · ${c.contactName}`} · {c.email}{c.phone && ` · ${c.phone}`}</>} />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[["Jobs", c.jobs.length], ["Quotes", c.quotes.length], ["Won", decided ? `${won} of ${decided}` : "—"], ["Approved spend", formatZar(spend)]].map(([l, v]) => (
          <div key={l as string} className="card !p-3"><p className="text-2xl font-extrabold tabular-nums">{v}</p><p className="text-xs font-bold text-gray-700">{l}</p></div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Jobs">
            {c.jobs.length === 0 ? <p className="muted">Not appointed for any job yet.</p> : (
              <ul className="divide-y divide-gray-200">{c.jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <Link className="link" href={`/jobs/${j.id}`}>{j.reference} {j.title}</Link><span className="text-gray-600">{j.site.name}</span>
                  <StatusBadge status={j.status} />{j.reopenCount > 0 && <span className="text-xs font-bold text-red-800">Reopened ×{j.reopenCount}</span>}
                </li>
              ))}</ul>
            )}
          </Card>
          <Card title="Quotes">
            {c.quotes.length === 0 ? <p className="muted">No quotes yet.</p> : (
              <ul className="divide-y divide-gray-200">{c.quotes.map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link className="link" href={`/quotes/${q.id}`}>{q.number}{q.version > 1 ? ` v${q.version}` : ""}</Link><span className="font-bold tabular-nums">{formatZar(q.totalCents)}</span><QuotePill status={q.status} />
                </li>
              ))}</ul>
            )}
          </Card>
        </div>
        {can(ctx, "contractors.manage") && (
          <Card title="Edit contractor" className="self-start">
            <Form action={updateContractorAction} hidden={{ id: c.id }}>
              <ContractorFields c={c} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="inactive" defaultChecked={!c.active} /> Inactive (no new quote requests)</label>
              <Submit>Save</Submit>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
