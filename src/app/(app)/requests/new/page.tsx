import { createJobAction } from "@/app/actions/jobs";
import { requirePage } from "@/app/_lib/session";
import { RequestPlaceFields } from "@/components/client-forms";
import { SignLine } from "@/components/requisition-fields";
import { Step, Stepper } from "@/components/stepper";
import { Form, Submit } from "@/components/form";
import Link from "@/components/link";
import { Card, Check, Empty, Field, PageHeader, Select, TextArea } from "@/components/ui";
import { can } from "@/server/permissions";
import { CATEGORIES } from "@/server/services/jobs";
import { requestFormOptions } from "@/server/services/sites";

export const metadata = { title: "Report a fault" };

export default async function NewRequest({ searchParams }: { searchParams: Promise<{ site?: string; location?: string; asset?: string }> }) {
  const { ctx, org } = await requirePage("job.create");
  const sp = await searchParams;
  const sites = await requestFormOptions(ctx);
  if (sites.length === 0)
    return <Empty title="Add a site first">A fault report needs to know where the problem is. {can(ctx, "sites.manage") ? <Link className="link" href="/sites">Add your first site</Link> : "Ask your maintenance manager to set up your site."}</Empty>;
  const fromQr = !!(sp.location || sp.asset);
  const simple = !can(ctx, "job.manage");
  return (
    <>
      <PageHeader title="Report a fault" subtitle="Tell the maintenance team what is wrong and where. Add a photo if you can." />
      <Card className="max-w-2xl">
        {/* People who only report faults get the large, simple version; maintenance staff keep the full form. */}
        <Form action={createJobAction} className={`space-y-4${simple ? " easy" : ""}`}>
          <Stepper>
            <Step title="What is wrong?">
              <Field label="What is the problem?" name="title" required maxLength={160} placeholder="e.g. Cold room door not sealing" />
              <TextArea label="Describe it" name="description" required rows={4} placeholder="What happened, when did it start, is anything unsafe?" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {!simple && <Select label="Type of problem" name="category" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />}
                <Select label="How urgent?" name="priority" defaultValue="NORMAL" options={[{ value: "LOW", label: "Low – when convenient" }, { value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High – affecting work" }, { value: "CRITICAL", label: "Critical – stopped / unsafe" }]} />
              </div>
              <Check name="emergency" label="This is an emergency (needs immediate attention)" />
              {!simple && <Check name="isProject" label="This is a project (planned work, not a breakdown)" />}
              <p className="text-xs text-gray-600">Urgency tells the team how quickly to respond. It does not replace your site&apos;s safety procedures: if there is danger, make the area safe and call your supervisor.</p>
            </Step>
            <Step title="Where is it?">
              {fromQr && <p className="rounded-md bg-blue-50 p-3 text-sm font-semibold text-blue-950">Filled in from the QR code. Change it if it is wrong.</p>}
              <RequestPlaceFields sites={sites} initial={{ siteId: sp.site, locationId: sp.location, assetId: sp.asset }} />
            </Step>
            <Step title="Add a photo">
              <p className="text-sm text-gray-700">A photo helps maintenance see the problem before they come out. You can skip this.</p>
              <Field label="Photos or documents" name="files" hint="JPEG, PNG, WebP or PDF, up to 10 MB each. Location data is removed from photos.">
                <input id="files" name="files" type="file" multiple accept="image/*,application/pdf" capture="environment" className="input" />
              </Field>
            </Step>
            <Step title="Check and sign" review>
              <SignLine label="Submitted by – your signature" required={!!org?.requireSignatures} />
              <p className="text-xs text-gray-600">The date and time of your report are recorded automatically. You will get a requisition number straight away.</p>
              <Submit className="btn btn-primary w-full sm:w-auto">Send report</Submit>
            </Step>
          </Stepper>
        </Form>
      </Card>
    </>
  );
}
