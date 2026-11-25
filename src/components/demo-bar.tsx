import { resetDemoAction, viewAsAction } from "@/app/actions/auth";
import { ActionButton, Form, Submit } from "./form";

type Persona = { userId: string; roles: string[]; user: { name: string; jobTitle: string } };

/**
 * Shown only in a demo company, only to its owner: switch between sample roles and reset the sample data.
 * The server enforces the same rules (src/server/auth.ts setViewAs / loadSession).
 */
export function DemoBar({ personas, viewAs, guestUntil }: { personas: Persona[]; viewAs?: { name: string; jobTitle: string } | null; guestUntil?: Date | null }) {
  return (
    <div className="no-print border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950" data-testid="demo-bar">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <span>{guestUntil
          ? <><strong>Your sandbox</strong> – sample data, private to you, gone after {guestUntil.toLocaleString("en-ZA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" })}. <a className="underline" href="/register">Start your own company</a></>
          : <><strong>Demo workspace</strong> – synthetic sample data, separate from your company. No emails are sent.</>}</span>
        <a href="?tour=start" className="btn btn-sm underline" data-testid="start-tour">Take the tour</a>
        {viewAs && <span className="rounded bg-amber-200 px-2 py-0.5 font-bold" data-testid="viewing-as">Viewing as {viewAs.name} ({viewAs.jobTitle})</span>}
        <Form action={viewAsAction} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="personaId">View as</label>
          <select id="personaId" name="personaId" defaultValue="" className="input !min-h-9 !w-auto !py-1 text-sm">
            <option value="">Myself</option>
            {personas.map((p) => <option key={p.userId} value={p.userId}>{p.user.jobTitle} – {p.user.name}</option>)}
          </select>
          <Submit className="btn btn-secondary btn-sm">View as</Submit>
        </Form>
        <ActionButton action={resetDemoAction} hidden={{}} className="btn btn-sm underline" confirm="Reset the demo? All sample data is rebuilt from the start.">Reset demo data</ActionButton>
      </div>
    </div>
  );
}
