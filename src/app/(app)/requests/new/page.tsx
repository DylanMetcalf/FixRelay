import Link from "@/components/link";
import { createJobAction } from "@/app/actions/jobs";
import { requirePage } from "@/app/_lib/session";
import { RequestPlaceFields } from "@/components/client-forms";
import { Form, Submit } from "@/components/form";
import { Card, Check, Empty, Field, PageHeader, Select, TextArea } from "@/components/ui";
import { can } from "@/server/permissions";
import { requestFormOptions } from "@/server/services/clients";
import { CATEGORIES } from "@/server/services/jobs";

export const metadata = { title: "New request" };

export default async function NewRequest() {
  const { ctx } = await requirePage("job.create");
  const clients = (await requestFormOptions(ctx)).filter((c) => c.sites.length > 0 || !can(ctx, "clients.manage"));
  if (clients.length === 0 || clients.every((c) => c.sites.length === 0))
    return (
      <Empty title="Add a customer and a site first">
        A request needs to know where the fault is. {can(ctx, "clients.manage") ? <Link className="link" href="/customers">Add a customer and site</Link> : "Ask your maintenance company to set up your site."}
      </Empty>
    );
  return (
    <>
      <PageHeader title="Log a maintenance request" subtitle="Tell us what is wrong and where. Add a photo if you can." />
      <Card className="max-w-2xl">
        <Form action={createJobAction} className="space-y-4">
          <Field label="What is the problem?" name="title" required maxLength={160} placeholder="e.g. Conveyor belt slipping on line 2" />
          <TextArea label="Describe it" name="description" required rows={4} placeholder="What happened, when did it start, is anything unsafe?" />
          <RequestPlaceFields clients={clients} />
          <div className="grid grid-cols-2 gap-3">
            <Select label="Category" name="category" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <Select label="Priority" name="priority" defaultValue="NORMAL" options={[{ value: "LOW", label: "Low" }, { value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High" }, { value: "CRITICAL", label: "Critical" }]} />
          </div>
          <Check name="emergency" label="This is an emergency (needs immediate attention)" />
          <p className="text-xs text-gray-600">Priority tells the team how urgent this is. It does not replace your site's safety procedures: if there is danger, make the area safe and phone your contact.</p>
          <Field label="Photos or documents" name="files" hint="JPEG, PNG, WebP or PDF, up to 10 MB each.">
            <input id="files" name="files" type="file" multiple accept="image/*,application/pdf" className="input" />
          </Field>
          <Submit className="btn btn-primary w-full sm:w-auto">Log request</Submit>
        </Form>
      </Card>
    </>
  );
}
