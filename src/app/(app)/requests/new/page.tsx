import { createJobAction } from "@/app/actions/jobs";
import { requirePage } from "@/app/_lib/session";
import { RequestPlaceFields } from "@/components/client-forms";
import { PriorityChoice, SignLine } from "@/components/requisition-fields";
import { Step, Stepper } from "@/components/stepper";
import { Form, Submit } from "@/components/form";
import Link from "@/components/link";
import { Card, Check, Empty, Field, PageHeader, Select, TextArea } from "@/components/ui";
import { can } from "@/server/permissions";
import { CATEGORIES } from "@/server/services/jobs";
import { requestFormOptions } from "@/server/services/sites";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { jobScope } from "@/server/permissions";

export const metadata = { title: "Report a fault" };

export default async function NewRequest({ searchParams }: { searchParams: Promise<{ site?: string; location?: string; asset?: string; repeatOf?: string }> }) {
  const { ctx, org } = await requirePage("job.create");
  const sp = await searchParams;
  const sites = await requestFormOptions(ctx);
  if (sites.length === 0)
    return <Empty title="Add a site first">A fault report needs to know where the problem is. {can(ctx, "sites.manage") ? <Link className="link" href="/sites">Add your first site</Link> : "Ask your maintenance manager to set up your site."}</Empty>;
  const fromQr = !!(sp.location || sp.asset);
  const simple = !can(ctx, "job.manage");
  // "The fault came back": the earlier job (if the person can see it) is linked and its place is filled in.
  const repeat = sp.repeatOf && /^[0-9a-f-]{36}$/.test(sp.repeatOf)
    ? await prisma.job.findFirst({ where: { id: sp.repeatOf, ...jobScope(ctx) }, select: { id: true, reference: true, title: true, siteId: true, locationId: true, assetId: true } })
    : null;
  const orgRules = await prisma.organisation.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { allowSelfJobs: true, selfJobSignOff: true } });
  const canSelf = orgRules.allowSelfJobs && can(ctx, "job.work");
  const departments = simple ? [] : await prisma.department.findMany({ where: { orgId: ctx.orgId, archived: false }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <>
      <PageHeader title="Report a fault" subtitle="Tell the maintenance team what is wrong and where. Add a photo if you can." />
      <Card className="max-w-2xl">
        {/* People who only report faults get the large, simple version; maintenance staff keep the full form. */}
        <Form action={createJobAction} hidden={{ submissionKey: randomUUID(), repeatOfId: repeat?.id ?? "" }} className={`space-y-4${simple ? " easy" : ""}`}>
          <Stepper>
            <Step title="What is wrong?">
              {repeat && <p className="rounded-md bg-red-50 p-3 text-sm font-semibold text-red-950" data-testid="repeat-note">Repeat fault: this report will be linked to {repeat.reference} ({repeat.title}).</p>}
              <Field label="What is the problem?" name="title" required maxLength={160} placeholder="e.g. Cold room door not sealing" defaultValue={repeat ? `Again: ${repeat.title}`.slice(0, 160) : undefined} />
              <TextArea label="Describe it" name="description" required rows={4} placeholder="What happened, when did it start, is anything unsafe?" />
              {!simple && <Select label="Type of problem" name="category" options={CATEGORIES.map((c) => ({ value: c, label: c }))} />}
              {!simple && <Check name="isProject" label="This is a project (planned work, not a breakdown)" />}
              {departments.length > 0 && <Select label="Responsible department (optional)" name="departmentId" options={[{ value: "", label: "Not set" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />}
            </Step>
            <Step title="How urgent is it?">
              <PriorityChoice />
              <Check name="emergency" label="This is an emergency (needs immediate attention)" />
              <p className="text-sm text-gray-600">If anyone is in danger, make the area safe and call your supervisor first.</p>
            </Step>
            <Step title="Where is it?">
              {fromQr && <p className="rounded-md bg-blue-50 p-3 text-sm font-semibold text-blue-950">Filled in from the QR code. Change it if it is wrong.</p>}
              <RequestPlaceFields sites={sites} initial={{ siteId: sp.site ?? repeat?.siteId, locationId: sp.location ?? repeat?.locationId ?? undefined, assetId: sp.asset ?? repeat?.assetId ?? undefined }} />
            </Step>
            <Step title="Add a photo">
              <p className="text-sm text-gray-700">A photo helps maintenance see the problem before they come out. You can skip this.</p>
              <Field label="Photos or documents" name="files" hint="JPEG, PNG, WebP or PDF, up to 10 MB each. Location data is removed from photos.">
                <input id="files" name="files" type="file" multiple accept="image/*,application/pdf" capture="environment" className="input" />
              </Field>
            </Step>
            <Step title="Check and sign" review>
              {canSelf && (
                <fieldset data-testid="who-fixes">
                  <legend className="label">Who will fix it?</legend>
                  <div className="mt-1 grid gap-2 sm:grid-cols-2">
                    <label className="choice"><input type="radio" name="who" value="managed" defaultChecked /><span>Send to maintenance management<span className="block text-sm font-normal text-gray-700">They assess it, approve any spend and assign someone.</span></span></label>
                    <label className="choice"><input type="radio" name="who" value="self" /><span>I&apos;ll fix it myself<span className="block text-sm font-normal text-gray-700">One-person job: you start now, complete it with evidence{orgRules.selfJobSignOff ? ", and a manager signs it off" : ", and it closes"}.</span></span></label>
                  </div>
                </fieldset>
              )}
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
