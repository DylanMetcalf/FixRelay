import { createContractorAction } from "@/app/actions/admin";
import { requirePage } from "@/app/_lib/session";
import { ContractorFields } from "@/components/contractor-fields";
import { Form, Submit } from "@/components/form";
import Link from "@/components/link";
import { Card, Empty, PageHeader, Pill } from "@/components/ui";
import { can } from "@/server/permissions";
import { listContractors } from "@/server/services/contractors";

export const metadata = { title: "Contractors" };

export default async function Contractors() {
  const { ctx } = await requirePage("contractors.view");
  const list = await listContractors(ctx);
  return (
    <>
      <PageHeader title="Contractors" subtitle="External companies you ask for quotes. They don't need an account: each job gets them a secure link." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {list.length === 0 ? <Empty title="No contractors yet">Add the companies you use for repairs you can't do in-house.</Empty> : (
            <ul className="space-y-2">
              {list.map((c) => (
                <li key={c.id}><Link href={`/contractors/${c.id}`} className="card flex items-center justify-between gap-3 !p-4 hover:border-gray-500">
                  <span><span className="block font-bold text-gray-900">{c.name} {!c.active && <Pill tone="gray">Inactive</Pill>}</span><span className="muted">{c.trade || "—"}{c.contactName && ` · ${c.contactName}`}</span></span>
                  <span className="text-right text-xs font-semibold text-gray-600">{c._count.quotes} quote{c._count.quotes === 1 ? "" : "s"}<br />{c._count.jobs} job{c._count.jobs === 1 ? "" : "s"}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </div>
        {can(ctx, "contractors.manage") && (
          <Card title="Add a contractor" className="self-start">
            <Form action={createContractorAction}><ContractorFields /><Submit>Add contractor</Submit></Form>
          </Card>
        )}
      </div>
    </>
  );
}
