"use client";
import { useState } from "react";
import type { ActionState } from "@/app/_lib/action";
import { ShareLink } from "./client";
import { Form, Submit } from "./form";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** A form whose successful result contains a one-time link (review link or invitation). */
export function LinkForm({ action, hidden, children, submit, shareLabel }: { action: Action; hidden?: Record<string, string>; children: React.ReactNode; submit: string; shareLabel: string }) {
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <Form action={action} hidden={hidden} onOk={(d) => setLink(d?.link ?? null)}>{children}<Submit>{submit}</Submit></Form>
      {link && <ShareLink link={link} label={shareLabel} />}
    </div>
  );
}

interface SiteOpt { id: string; name: string; locations: { id: string; name: string }[]; assets: { id: string; name: string; reference: string; locationId: string | null }[] }

/** Site → location/equipment pickers that narrow as you choose. Pre-filled from a QR code when given. */
export function RequestPlaceFields({ sites, initial = {} }: { sites: SiteOpt[]; initial?: { siteId?: string; locationId?: string; assetId?: string } }) {
  const [siteId, setSiteId] = useState(initial.siteId && sites.some((s) => s.id === initial.siteId) ? initial.siteId : sites.length === 1 ? sites[0]!.id : "");
  const site = sites.find((s) => s.id === siteId);
  const [locationId, setLocationId] = useState(initial.locationId ?? "");
  const assets = site?.assets.filter((a) => !locationId || !a.locationId || a.locationId === locationId) ?? [];
  return (
    <>
      <div>
        <label className="label" htmlFor="siteId">Site <span className="text-red-700">*</span></label>
        <select id="siteId" name="siteId" className="input" required value={siteId} onChange={(e) => { setSiteId(e.target.value); setLocationId(""); }}>
          {sites.length !== 1 && <option value="">Choose a site…</option>}
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      {site && site.locations.length > 0 && (
        <div>
          <label className="label" htmlFor="locationId">Where exactly?</label>
          <select id="locationId" name="locationId" className="input" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            <option value="">Not specified</option>{site.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}
      {site && assets.length > 0 && (
        <div>
          <label className="label" htmlFor="assetId">Which equipment?</label>
          <select id="assetId" name="assetId" className="input" defaultValue={initial.assetId ?? ""}><option value="">Not about a specific machine</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.reference} – {a.name}</option>)}</select>
        </div>
      )}
    </>
  );
}
