"use client";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Guided walkthrough across the real screens. Start it with ?tour=start (the sandbox does this) or the
 * "Take the tour" button.
 *
 * Built to feel calm rather than jumpy:
 * - few steps, grouped so the page only changes three times (dashboard → one job → sites → How it works);
 * - pages change with client-side navigation, and the card stays on screen ("Opening …") while they load;
 * - the card always sits in the same corner (a bottom sheet on phones) and never hops around the screen;
 * - the highlight glides to its target and follows it while the page scrolls.
 * Progress is kept in sessionStorage so it survives page changes; Esc or "End tour" stops it, ← and → move.
 */
type Step = { path: string; target?: string; title: string; body: string };

const STEPS: Step[] = [
  { path: "/dashboard", title: "Welcome to ManOp", body: "In about two minutes you will see where faults come in, how a job moves from reported to resolved, and where the job card is. Use Next, or the arrow keys." },
  { path: "/dashboard", target: '[data-tour="attention"]', title: "1. What needs you now", body: "Only the things waiting on a manager show here: reports nobody owns, QR reports to screen, possible duplicates, overdue jobs and one-person jobs to sign off. When it is empty, you are up to date." },
  { path: "/dashboard", target: '[data-tour="tiles"]', title: "2. Where every job is", body: "Every open job is in one of five stages, in order: reported, being looked at, waiting to start, being fixed, checking and closing. Tap a stage to see its jobs." },
  { path: "/dashboard", target: '[data-tour="report-button"]', title: "3. Report a fault", body: "Anyone can report – here, or by scanning the QR code on a machine or door. Maintenance staff choose how it runs: through maintenance management, or “I’ll fix it myself” as a one-person job." },
  { path: "@job", target: '[data-testid="next-action"]', title: "4. Every job says what happens next", body: "This is one job. The box always names the next step and who is responsible, so nothing waits on the wrong person." },
  { path: "@job", target: '[data-tour="actions"]', title: "5. Only the buttons that fit", body: "You only see what fits this stage and your role: assess, get quotes, approve, assign, hand over to another department – or take it yourself." },
  { path: "@job", target: '[data-testid="documents"]', title: "6. The job card", body: "Every job is also a branded A4 job card with photos and a QR code back to this page. Finished jobs add a completion report, and every step is kept in the history below." },
  { path: "/sites", target: '[data-tour="sites"]', title: "7. Sites, areas and QR codes", body: "Your sites, their areas and equipment. Each gets its own QR sign: scanning it opens the report form with the place already filled in." },
  { path: "/how-it-works", title: "8. Two ways a job runs", body: "Managed jobs go through maintenance management; one-person jobs are done start to finish by the person on the spot. This page shows both, step by step. Try “View as” in the yellow bar next." },
];

const KEY = "manop_tour_step";
const JOB_KEY = "manop_tour_job";
const read = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* storage blocked */ } };
const isJobPage = (p: string) => /^\/jobs\/[0-9a-f-]{36}$/.test(p);

export function Tour({ jobHref }: { jobHref?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [i, setI] = useState<number | null>(null);
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const [moving, setMoving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Remember a job to show, so the job steps never bounce via the jobs board.
  useEffect(() => { if (jobHref) write(JOB_KEY, jobHref); }, [jobHref]);
  const pathFor = useCallback((step: Step) => (step.path === "@job" ? (isJobPage(location.pathname) ? location.pathname : read(JOB_KEY) ?? "/jobs") : step.path), []);
  const onPage = (step: Step, p: string) => (step.path === "@job" ? isJobPage(p) : p === step.path);

  // Start (?tour=start) or resume after a page change.
  useEffect(() => {
    const url = new URL(location.href);
    if (url.searchParams.get("tour") === "start") {
      write(KEY, "0");
      url.searchParams.delete("tour");
      history.replaceState(history.state, "", url.pathname + (url.search || ""));
    }
    const v = read(KEY);
    const n = v === null ? null : Number(v);
    if (n === null || Number.isNaN(n) || n >= STEPS.length) { setI(null); return; }
    const step = STEPS[n]!;
    if (!onPage(step, pathname)) { setMoving(true); setI(n); router.push(pathFor(step)); return; }
    setMoving(false);
    setI(n);
  }, [pathname, router, pathFor]);

  // Follow the target smoothly: scroll it into view once, then track its position every frame.
  useEffect(() => {
    if (i === null || moving) return;
    const sel = STEPS[i]!.target;
    let raf = 0; let tries = 0; let scrolled = false;
    const tick = () => {
      const el = sel ? document.querySelector<HTMLElement>(sel) : null;
      if (el && el.offsetParent !== null) {
        if (!scrolled) {
          scrolled = true;
          const r = el.getBoundingClientRect();
          const sheet = window.innerWidth < 768 ? (cardRef.current?.offsetHeight ?? 220) + 24 : 0;
          const room = window.innerHeight - sheet;
          if (r.top < 72 || r.bottom > room) window.scrollTo({ top: window.scrollY + r.top - Math.max(80, (room - r.height) / 2), behavior: "smooth" });
        }
        const r = el.getBoundingClientRect();
        setBox((b) => (b && Math.abs(b.top - r.top) < 0.5 && Math.abs(b.left - r.left) < 0.5 && Math.abs(b.width - r.width) < 0.5 && Math.abs(b.height - r.height) < 0.5 ? b : { top: r.top, left: r.left, width: r.width, height: r.height }));
      } else if (++tries > 180) setBox(null); // ~3 s: carry on without a highlight
      raf = requestAnimationFrame(tick);
    };
    if (!sel) setBox(null);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [i, moving]);

  const stop = useCallback(() => { write(KEY, null); setI(null); setBox(null); }, []);
  const go = useCallback((n: number) => {
    if (n < 0) return;
    if (n >= STEPS.length) return stop();
    write(KEY, String(n));
    const step = STEPS[n]!;
    if (onPage(step, location.pathname)) { setI(n); return; }
    setMoving(true); setI(n);
    router.push(pathFor(step));
  }, [router, pathFor, stop]);

  useEffect(() => {
    if (i === null) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      if (e.key === "Escape") stop();
      else if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [i, go, stop]);

  useEffect(() => { if (i !== null && !moving) document.getElementById("tour-title")?.focus({ preventScroll: true }); }, [i, moving]);

  if (i === null) return null;
  const step = STEPS[i]!;
  const pad = 8;
  const highlight = box && !moving && step.target;
  return (
    <div className="no-print" data-testid="tour">
      <div aria-hidden className="pointer-events-none fixed z-[60] rounded-xl ring-4 ring-signal transition-[top,left,width,height,opacity] duration-500 ease-out"
        style={highlight
          ? { top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2, boxShadow: "0 0 0 9999px rgba(11,31,58,0.5)", opacity: 1 }
          : { top: "50%", left: "50%", width: 0, height: 0, boxShadow: "0 0 0 9999px rgba(11,31,58,0.5)", opacity: 1 }} />
      <div ref={cardRef} role="dialog" aria-labelledby="tour-title" aria-describedby="tour-body"
        className="fixed inset-x-0 bottom-0 z-[61] rounded-t-2xl bg-white p-5 shadow-2xl md:inset-x-auto md:bottom-6 md:right-6 md:w-[26rem] md:rounded-2xl">
        <div className="mb-3 flex gap-1" aria-hidden>
          {STEPS.map((_, n) => <span key={n} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${n <= i ? "bg-signal" : "bg-gray-200"}`} />)}
        </div>
        <div key={i} className="tour-in">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600">Tour · step {i + 1} of {STEPS.length}</p>
          <h2 id="tour-title" tabIndex={-1} className="mt-1 text-lg font-extrabold text-gray-900 outline-none focus:outline-none" style={{ boxShadow: "none" }}>{step.title}</h2>
          <p id="tour-body" className="mt-1 text-sm leading-relaxed text-gray-800">{moving ? "Opening the next screen…" : step.body}</p>
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" className="btn btn-sm underline" onClick={stop}>{i === 0 ? "Not now" : "End tour"}</button>
          <span className="flex gap-2">
            {i > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => go(i - 1)} disabled={moving}>← Back</button>}
            <button type="button" className="btn btn-primary btn-sm" onClick={() => go(i + 1)} disabled={moving} data-testid="tour-next">{i === 0 ? "Start the tour →" : i === STEPS.length - 1 ? "Finish" : "Next →"}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
