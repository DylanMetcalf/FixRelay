import Link from "@/components/link";
import { createClientAction } from "@/app/actions/admin";
import { requirePage } from "@/app/_lib/session";
import { Form, Submit } from "@/components/form";
import { Card, Empty, Field, PageHeader } from "@/components/ui";
import { can } from "@/server/permissions";
import { listClients } from "@/server/services/clients";

export const metadata = { title: "Customers" };

export default async function Customers() {
  const { ctx } = await requirePage("clients.view");
  const clients = await listClients(ctx);
  return (
    <>
      <PageHeader title="Customers" subtitle="The organisations you do maintenance for, and their sites." />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {clients.length === 0 ? <Empty title="No customers yet">Add your first customer to start logging work for them.</Empty> : (
            <ul className="space-y-2">
              {clients.map((c) => (
                <li key={c.id}><Link href={`/customers/${c.id}`} className="card flex items-center justify-between gap-3 !p-4 hover:border-gray-500">
                  <span><span className="block font-bold text-gray-900">{c.name}</span><span className="muted">{c.contactName || "No contact"}{c.phone && ` · ${c.phone}`}</span></span>
                  <span className="text-right text-xs font-semibold text-gray-600">{c._count.sites} site{c._count.sites === 1 ? "" : "s"}<br />{c._count.jobs} job{c._count.jobs === 1 ? "" : "s"}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </div>
        {can(ctx, "clients.manage") && (
          <Card title="Add a customer" className="self-start">
            <Form action={createClientAction}>
              <Field label="Customer name" name="name" required />
              <Field label="Contact person" name="contactName" />
              <Field label="Email" name="email" type="email" />
              <Field label="Phone" name="phone" type="tel" />
              <Submit>Add customer</Submit>
            </Form>
          </Card>
        )}
      </div>
    </>
  );
}
