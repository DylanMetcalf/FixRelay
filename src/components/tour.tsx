"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * Guided walkthrough across the real screens. Start it with ?tour=start (the sandbox does this) or the
 * "Take the tour" button. Each step names the page it belongs to and the element it points at
 * ([data-tour] / [data-testid]); the spotlight follows the element, and the card explains what it is for.
 * Progress is kept in sessionStorage so the tour survives page changes; Esc or "End tour" stops it.
 */
type Step = { path: string; target?: string; title: string; body: string };

const STEPS: Step[] = [
  { path: "/dashboard", title: "Welcome to ManOp", body: "This tour takes about two minutes. It shows where faults come in, how a job moves from reported to resolved, and where the job card is. You can end it at any time." },
  { path: "/dashboard", target: '[data-tour="tiles"]', title: "Your control room", body: "Every tile is a live count of jobs at one stage: new reports, unassigned work, possible duplicates, quotes, approvals, work in progress, one-person jobs, overdue and completed. Tap a tile to see those jobs." },
  { path: "/dashboard", target: '[data-testid="demo-bar"]', title: "See it through anyone's eyes", body: "In the sandbox you can view ManOp as the technician, the finance approver, an operator who reports faults, and more. Try it after the tour." },
  { path: "/dashboard", target: '[data-tour="report-button"]', title: "Report a fault", body: "Anyone can report: in the app, or by scanning a QR code on site without an account. Maintenance staff then choose how it runs: send it to maintenance management, or 'I'll fix it myself' as a one-person job." },
  { path: "/jobs", target: '[data-testid="job-tabs"]', title: "Open now and History", body: "Open work is listed most urgent first; finished and cancelled jobs move to History. Every card shows the reported photo." },
  { path: "/jobs", target: '[data-testid="priority-chips"]', title: "Filter by urgency", body: "Critical, High, Medium and Low, with live counts. More filters: status, department, site, technician and dates." },
  { path: "@job", target: '[data-testid="next-action"]', title: "What happens next", body: "Every job always says the next step and who is responsible, so nothing waits on the wrong person." },
  { path: "@job", target: '[data-tour="actions"]', title: "The actions for this step", body: "Only what fits the job's stage and your role: assess, fix in-house or get contractor quotes, assign, hand over to another department, or take it yourself as a one-person job." },
  { path: "@job", target: '[data-testid="documents"]', title: "The job card", body: "Every job is also a branded A4 job card: view, print or download it, with the photos and a QR code back to the digital record. Completed jobs add a completion report; managers can export the full history." },
  { path: "@job", target: '[data-testid="timeline"]', title: "Nothing gets lost", body: "Every step is recorded with who and when: reports, handovers, quotes, approvals, work updates, sign-off. It cannot be edited or deleted." },
  { path: "/sites", target: '[data-tour="sites"]', title: "Sites, areas and QR codes", body: "Add your sites, their areas (Workshop, Warehouse, Production …) and equipment. Each gets its own QR sign: scanning it opens the report form with the place filled in." },
  { path: "/settings", target: "#departments", title: "Your team and rules", body: "Departments and department managers, registration codes and approvals for new employees, approval limits, signatures and the one-person job rules all live in Settings." },
  { path: "/how-it-works", title: "Two ways a job runs", body: "Managed jobs go through maintenance management. One-person jobs are done start to finish by the person on the spot. This page shows both, step by step. That's the tour: try viewing as the technician and finishing a job." },
];

const KEY = "manop_tour_step";
const read = () => { try { const v = sessionStorage.getItem(KEY); return v === null ? null : Number(v); } catch { return null; } };
const write = (n: number | null) => { try { if (n === null) sessionStorage.removeItem(KEY); else sessionStorage.setItem(KEY, String(n)); } catch { /* storage blocked */ } };

/** The page a step lives on. "@job" = the first job on the jobs board (or the job already open). */
function pathFor(step: Step): string | null {
  if (step.path !== "@job") return step.path;
  if (/^\/jobs\/[0-9a-f-]{36}$/.test(location.pathname)) return location.pathname;
  const link = document.querySelector<HTMLAnchorElement>('a[href^="/jobs/"][href*="-"]');
  return link ? new URL(link.href).pathname : "/jobs";
}
const onPage = (step: Step) => (step.path === "@job" ? /^\/jobs\/[0-9a-f-]{36}$/.test(location.pathname) : location.pathname === step.path);

export function Tour() {
  const [i, setI] = useState<number | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);

  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get("tour") === "start") {
      write(0);
      url.searchParams.delete("tour");
      history.replaceState(null, "", url.pathname + (url.search || ""));
    }
    const n = read();
    if (n === null || n >= STEPS.length) return;
    const step = STEPS[n]!;
    if (!onPage(step)) { const p = pathFor(step); if (p && p !== location.pathname) { location.assign(p); return; } }
    setI(n);
  }, []);

  const measure = useCallback(() => {
    if (i === null) return;
    const t = STEPS[i]!.target;
    const el = t ? document.querySelector<HTMLElement>(t) : null;
    if (el && el.offsetParent !== null) setBox(el.getBoundingClientRect()); else setBox(null);
  }, [i]);

  useEffect(() => {
    if (i === null) return;
    const t = STEPS[i]!.target;
    const el = t ? document.querySelector<HTMLElement>(t) : null;
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const id = setTimeout(measure, 350);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") stop(); };
    window.addEventListener("keydown", key);
    document.getElementById("tour-title")?.focus();
    return () => { clearTimeout(id); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); window.removeEventListener("keydown", key); };
  }, [i, measure]);

  const stop = () => { write(null); setI(null); };
  const go = (n: number) => {
    if (n < 0) return;
    if (n >= STEPS.length) return stop();
    write(n);
    const step = STEPS[n]!;
    if (onPage(step)) { setI(n); return; }
    const p = pathFor(step);
    if (p) location.assign(p);
  };

  if (i === null) return null;
  const step = STEPS[i]!;
  const pad = 8;
  const below = box ? box.bottom + 220 < window.innerHeight : true;
  return (
    <div className="no-print" data-testid="tour">
      {box
        ? <div aria-hidden className="pointer-events-none fixed z-[60] rounded-lg ring-4 ring-signal transition-all" style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2, boxShadow: "0 0 0 9999px rgba(11,31,58,0.55)" }} />
        : <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] bg-navy/55" />}
      <div role="dialog" aria-labelledby="tour-title" aria-describedby="tour-body"
        className="fixed inset-x-3 bottom-20 z-[61] mx-auto max-w-md rounded-xl bg-white p-4 shadow-2xl md:inset-x-auto md:bottom-auto"
        style={box && window.innerWidth >= 768 ? { top: below ? Math.min(box.bottom + 16, window.innerHeight - 230) : Math.max(box.top - 226, 12), left: Math.min(Math.max(box.left, 12), window.innerWidth - 460) } : (window.innerWidth >= 768 ? { top: "30%", left: "calc(50% - 224px)" } : undefined)}>
        <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Tour · {i + 1} of {STEPS.length}</p>
        <h2 id="tour-title" tabIndex={-1} className="mt-1 text-lg font-extrabold text-gray-900 outline-none">{step.title}</h2>
        <p id="tour-body" className="mt-1 text-sm text-gray-800">{step.body}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" className="btn btn-sm underline" onClick={stop}>End tour</button>
          <span className="flex gap-2">
            {i > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(i - 1)}>← Back</button>}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => go(i + 1)} data-testid="tour-next">{i === STEPS.length - 1 ? "Finish" : "Next →"}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
