import { ROOT_CAUSE_LABEL } from "@/server/workflow";
import { SignaturePad } from "./client";

/** Root cause boxes, notes and (food areas only) the tools/clean-area check — as on the paper requisition. */
export function RootCauseFields({ foodArea }: { foodArea: boolean }) {
  return (
    <>
      <fieldset data-testid="root-causes" data-require-one="Tick at least one root cause.">
        <legend className="label">Root cause <span className="text-red-700">*</span> <span className="font-normal text-gray-600">(tick all that apply)</span></legend>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
          {Object.entries(ROOT_CAUSE_LABEL).map(([v, l]) => (
            <label key={v} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="rootCauses" value={v} className="h-4 w-4" />{l}</label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="rootCauseNotes">Root cause notes</label>
        <textarea id="rootCauseNotes" name="rootCauseNotes" rows={2} className="input" placeholder="What caused it, and how to stop it happening again" />
      </div>
      {foodArea && (
        <fieldset className="rounded-md border border-amber-300 bg-amber-50 p-3" data-testid="tools-check">
          <legend className="label px-1">Food-handling area: tools out = tools in, and the area is clean and tidy? <span className="text-red-700">*</span></legend>
          <div className="flex gap-4">
            <label className="flex min-h-9 items-center gap-2 text-sm"><input type="radio" name="toolsAndAreaOk" value="yes" required className="h-4 w-4" />Yes</label>
            <label className="flex min-h-9 items-center gap-2 text-sm"><input type="radio" name="toolsAndAreaOk" value="no" className="h-4 w-4" />No</label>
          </div>
        </fieldset>
      )}
    </>
  );
}

/** One signature line of the requisition. */
export function SignLine({ label, required, hint }: { label: string; required: boolean; hint?: string }) {
  return <SignaturePad label={label} required={required} hint={hint} />;
}
