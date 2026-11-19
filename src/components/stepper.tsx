"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Guided form: shows one section at a time ("one question at a time"), checks each section before moving on,
 * and ends with a review of everything entered, laid out like the requisition, before signing and sending.
 *
 * Usage (inside a <Form>):
 *   <Stepper>
 *     <Step title="What is wrong?">…fields…</Step>
 *     <Step title="Where is it?">…fields…</Step>
 *     <Step title="Check and sign" review>…signature + submit…</Step>
 *   </Stepper>
 * All fields stay in the one form, so the server action receives everything exactly as before.
 */
export function Step({ title, review, children }: { title: string; review?: boolean; children: React.ReactNode }) {
  return <section data-step={review ? "review" : "input"} data-title={title} className="space-y-4">{children}</section>;
}

type Row = { label: string; value: string; image?: string };
type Summary = { title: string; index: number; rows: Row[] }[];

const fieldLabel = (el: HTMLElement): string => {
  const id = el.getAttribute("id");
  const byFor = id ? el.closest("form")?.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  const text = (byFor?.textContent ?? el.closest("label")?.textContent ?? el.closest("fieldset")?.querySelector("legend")?.textContent ?? el.getAttribute("aria-label") ?? "").replace(/\s*\*\s*/g, " ").replace(/\(.*?\)/g, "").trim();
  return text;
};

function summarise(section: HTMLElement): Row[] {
  const rows: Row[] = [];
  const done = new Set<string>();
  for (const el of Array.from(section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input[name], select[name], textarea[name]"))) {
    const name = el.name;
    if (done.has(name)) continue;
    if (el instanceof HTMLInputElement && el.type === "hidden") {
      if (el.dataset.signature !== undefined && el.value) rows.push({ label: el.dataset.label ?? "Signature", value: "Signed", image: el.value });
      else if (el.dataset.summaryLabel) rows.push({ label: el.dataset.summaryLabel, value: el.dataset.summaryValue ?? el.value });
      continue;
    }
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      const group = Array.from(section.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`));
      done.add(name);
      if (group.length === 1 && el.type === "checkbox") { if (el.checked) rows.push({ label: fieldLabel(el), value: "Yes" }); continue; }
      const legend = el.closest("fieldset")?.querySelector("legend")?.textContent?.replace(/\s*\*.*$/, "").replace(/\(.*?\)/g, "").trim() ?? name;
      const picked = group.filter((g) => g.checked).map((g) => { const l = g.closest("label"); return l?.dataset.summary ?? l?.textContent?.trim() ?? g.value; });
      if (picked.length) rows.push({ label: legend, value: picked.join(", ") });
      continue;
    }
    done.add(name);
    let value = "";
    if (el instanceof HTMLSelectElement) value = el.value ? (el.selectedOptions[0]?.textContent ?? "") : "";
    else if (el instanceof HTMLInputElement && el.type === "file") value = Array.from(el.files ?? []).map((f) => f.name).join(", ");
    else value = el.value;
    if (value.trim()) rows.push({ label: fieldLabel(el), value: value.trim() });
  }
  return rows;
}

export function Stepper({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const [titles, setTitles] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const sections = useCallback(() => Array.from(box.current?.querySelectorAll<HTMLElement>(":scope > div > section[data-step]") ?? []), []);

  useEffect(() => { setTitles(sections().map((s) => s.dataset.title ?? "")); }, [sections]);
  useEffect(() => { sections().forEach((s, n) => { s.hidden = n !== i; }); }, [i, sections, titles]);

  /** Every required field in the current section is filled in (including "tick at least one" groups and signatures). */
  const check = (): boolean => {
    const s = sections()[i];
    if (!s) return true;
    for (const el of Array.from(s.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea"))) {
      if (el.type !== "hidden" && !el.checkValidity()) { el.reportValidity(); return false; }
    }
    for (const g of Array.from(s.querySelectorAll<HTMLElement>("[data-require-one]"))) {
      if (!g.querySelector("input:checked")) { setProblem(g.dataset.requireOne ?? "Choose at least one option."); g.scrollIntoView({ block: "center" }); return false; }
    }
    for (const sig of Array.from(s.querySelectorAll<HTMLInputElement>("input[data-signature][data-required='true']"))) {
      if (!sig.value) { setProblem("Please sign in the box before continuing."); sig.parentElement?.scrollIntoView({ block: "center" }); return false; }
    }
    return true;
  };
  const go = (n: number) => {
    setProblem(null);
    const all = sections();
    if (all[n]?.dataset.step === "review") setSummary(all.slice(0, n).map((s, index) => ({ title: s.dataset.title ?? "", index, rows: summarise(s) })));
    setI(n);
    box.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const next = () => { if (check()) go(i + 1); };
  const last = i === titles.length - 1;

  // Enter in a one-line field moves to the next step instead of sending the form early.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === "Enter" && !last && t.tagName === "INPUT" && (t as HTMLInputElement).type !== "submit") { e.preventDefault(); next(); }
  };

  return (
    <div ref={box} onKeyDown={onKeyDown} data-testid="stepper" data-step-index={i}>
      {titles.length > 1 && (
        <div className="mb-4" aria-live="polite">
          <p className="text-xs font-bold uppercase tracking-wide text-gray-600" data-testid="step-label">Step {i + 1} of {titles.length} · {titles[i]}</p>
          <div className="mt-1.5 flex gap-1.5" aria-hidden>{titles.map((t, n) => <span key={t} className={`h-1.5 flex-1 rounded-full ${n <= i ? "bg-signal" : "bg-gray-300"}`} />)}</div>
          <h2 className="mt-3 text-xl font-extrabold">{titles[i]}</h2>
        </div>
      )}
      {last && summary.length > 0 && (
        <div className="mb-4 overflow-hidden rounded-lg border-2 border-navy" data-testid="review">
          <p className="bg-navy px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white">Please check before you sign</p>
          {summary.map((s) => (
            <div key={s.title} className="border-t border-gray-200 px-3 py-2 first:border-t-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-extrabold">{s.title}</p>
                <button type="button" className="link text-sm" onClick={() => go(s.index)}>Edit<span className="sr-only"> {s.title}</span></button>
              </div>
              {s.rows.length === 0 ? <p className="mt-1 text-sm text-gray-600">Nothing added</p> : (
              <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[11rem_1fr]">

                {s.rows.map((r) => (
                  <div key={r.label} className="contents">
                    <dt className="font-semibold text-gray-700">{r.label}</dt>
                    <dd className="whitespace-pre-line break-words">
                      {r.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.image} alt="Your signature" className="h-10 border border-gray-300 bg-white" />
                      ) : r.value}
                    </dd>
                  </div>
                ))}
              </dl>
              )}
            </div>
          ))}
        </div>
      )}
      <div>{children}</div>
      {problem && <p role="alert" className="mt-3 rounded-md bg-red-50 p-2 text-sm font-semibold text-red-800">{problem}</p>}
      {titles.length > 1 && (
        <div className="mt-4 flex items-center justify-between gap-2">
          {i > 0 ? <button type="button" className="btn btn-secondary" onClick={() => go(i - 1)}>← Back</button> : <span />}
          {!last && <button type="button" className="btn btn-primary" onClick={next}>Next →</button>}
        </div>
      )}
    </div>
  );
}
