"use client";
import { useState } from "react";
import { publicReportAction } from "@/app/actions/jobs";
import { SignaturePad } from "./client";
import { Form, Submit } from "./form";
import { PriorityChoice } from "./requisition-fields";
import { Step, Stepper } from "./stepper";

type Loc = { id: string; name: string };

const KINDS = ["Not working", "Broken", "Leaking", "Blocked or dirty", "Unsafe"];

/**
 * The QR-code report for anyone on site – no account, no training. One short question per screen, big text and
 * buttons, the place already filled in from the code, an optional photo, and a clear "thank you" with the number.
 */
export function QuickReport({ token, siteName, locations, initialLocationId, asset, requireSignatures }: {
  token: string; siteName: string; locations: Loc[]; initialLocationId?: string; asset?: { id: string; label: string } | null; requireSignatures: boolean;
}) {
  const [done, setDone] = useState<string | null>(null);
  const [changing, setChanging] = useState(!initialLocationId);
  const [photos, setPhotos] = useState(0);
  const here = locations.find((l) => l.id === initialLocationId);

  if (done !== null) {
    return (
      <div className="easy space-y-5 py-4 text-center" data-testid="report-done" role="status">
        <div aria-hidden className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-700 text-4xl font-bold text-white">✓</div>
        <h2 className="text-3xl font-extrabold">Thank you!</h2>
        <p className="text-lg">The maintenance team has your report.</p>
        <div className="mx-auto max-w-xs rounded-xl border-2 border-gray-300 bg-white p-4">
          <p className="text-sm font-bold uppercase tracking-wide text-gray-600">Your report number</p>
          <p className="text-4xl font-extrabold tabular-nums" data-testid="report-number">{done}</p>
        </div>
        <p className="text-gray-700">You can close this page now.</p>
        <button type="button" className="btn btn-secondary w-full" onClick={() => { setDone(null); setPhotos(0); setChanging(!initialLocationId); }}>Report another problem</button>
      </div>
    );
  }

  return (
    <Form action={publicReportAction} hidden={{ siteToken: token, assetId: asset?.id ?? "" }} onOk={(d) => setDone(d?.reference ?? "")} className="easy space-y-4">
      <Stepper>
        <Step title="What’s wrong?">
          <fieldset>
            <legend className="label">What kind of problem? <span className="font-normal text-gray-600">(tap one, if it fits)</span></legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <label key={k} className="choice"><input type="radio" name="kind" value={k} />{k}</label>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="label" htmlFor="qr-description">Tell us in your own words <span className="text-red-700">*</span></label>
            <textarea id="qr-description" name="description" required minLength={3} maxLength={2000} rows={4} className="input" placeholder="For example: the tap in the kitchen won’t stop dripping" />
          </div>
        </Step>

        <Step title="How urgent is it?">
          <PriorityChoice />
        </Step>

        <Step title="Where is it?">
          {asset && <p className="rounded-xl bg-blue-50 p-4 text-lg"><span className="block text-sm font-bold uppercase tracking-wide text-blue-900">Machine</span>{asset.label}</p>}
          {!changing && here ? (
            <div className="rounded-xl border-2 border-gray-300 bg-white p-4" data-testid="place-confirm">
              <input type="hidden" name="locationId" value={here.id} data-summary-label="Place" data-summary-value={`${here.name}, ${siteName}`} />
              <p className="text-sm font-bold uppercase tracking-wide text-gray-600">You are at</p>
              <p className="text-2xl font-extrabold">{here.name}</p>
              <p className="text-gray-700">{siteName}</p>
              <button type="button" className="link mt-3 text-base" onClick={() => setChanging(true)}>Not here? Change the place</button>
            </div>
          ) : (
            <fieldset>
              <legend className="label">Where is the problem?</legend>
              <div className="mt-2 grid gap-2">
                {locations.map((l) => (
                  <label key={l.id} className="choice"><input type="radio" name="locationId" value={l.id} defaultChecked={l.id === initialLocationId} />{l.name}</label>
                ))}
                <label className="choice"><input type="radio" name="locationId" value="" defaultChecked={!initialLocationId} />Somewhere else / not sure</label>
              </div>
            </fieldset>
          )}
        </Step>

        <Step title="Add a photo">
          <p className="text-lg text-gray-700">A photo helps the team see the problem. You can skip this.</p>
          <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-400 bg-white p-4 text-center text-lg font-semibold text-blue-900 focus-within:outline focus-within:outline-3 focus-within:outline-amber-500">
            <svg aria-hidden width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
            {photos ? `${photos} photo${photos === 1 ? "" : "s"} added – tap to change` : "Take or choose a photo"}
            <input type="file" name="photos" accept="image/*" capture="environment" multiple className="sr-only" aria-label="Photo of the problem" onChange={(e) => setPhotos(Math.min(e.currentTarget.files?.length ?? 0, 3))} />
          </label>
          <p className="text-sm text-gray-600">Up to 3 photos. Location data is removed from photos.</p>
        </Step>

        <Step title="Your name and number">
          <div>
            <label className="label" htmlFor="qr-name">Your name <span className="text-red-700">*</span></label>
            <input id="qr-name" name="reporterName" required minLength={2} maxLength={120} autoComplete="name" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="qr-phone">Phone number <span className="text-red-700">*</span></label>
            <input id="qr-phone" name="reporterPhone" required minLength={6} maxLength={40} type="tel" inputMode="tel" autoComplete="tel" className="input" />
          </div>
          <p className="text-sm text-gray-600">Only the maintenance team sees this, so they can ask you about the problem.</p>
        </Step>

        <Step title="Check and send" review>
          {requireSignatures && <SignaturePad label="Your signature" required hint="Sign with your finger." />}
          <Submit className="btn btn-primary w-full">Send report</Submit>
        </Step>
      </Stepper>
    </Form>
  );
}
