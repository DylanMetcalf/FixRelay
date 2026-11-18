"use client";
import Link from "@/components/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function ServiceWorker() {
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const updateRequested = useRef(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      const watch = (w: ServiceWorker | null) => w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) setUpdate(w); });
      watch(reg.installing);
      reg.addEventListener("updatefound", () => watch(reg.installing));
    }).catch(() => {});
    // Reload ONLY after the user chose "Update". The first install also fires controllerchange (clients.claim),
    // and reloading then would wipe whatever a first-time visitor had started typing.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (updateRequested.current) { updateRequested.current = false; window.location.reload(); }
    });
  }, []);
  if (!update) return null;
  return (
    <div role="status" className="no-print fixed inset-x-4 bottom-24 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg bg-navy px-4 py-3 text-sm text-white shadow-lg md:bottom-6">
      <span>A new version of FixRelay is ready.</span>
      <button className="btn btn-sm bg-signal text-navy" onClick={() => { updateRequested.current = true; update.postMessage("skipWaiting"); }}>Update</button>
    </div>
  );
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** "Install app" button: uses the browser prompt where available, and shows iPhone instructions otherwise. */
export function InstallButton({ className = "btn bg-signal text-navy" }: { className?: string }) {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    const on = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", on);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);
  if (installed) return <p className="text-sm font-semibold">✓ FixRelay is installed on this device.</p>;
  return (
    <div>
      <button type="button" className={className} onClick={async () => { if (evt) { await evt.prompt(); setEvt(null); } else setHelp((h) => !h); }}>Install FixRelay app</button>
      {help && (
        <p className="mt-2 text-sm" role="note">
          <strong>iPhone / iPad:</strong> open this page in Safari, tap Share, then <em>Add to Home Screen</em>. <strong>Android:</strong> open the browser menu (⋮) and tap <em>Install app</em>. <strong>Desktop:</strong> use the install icon in the address bar.
        </p>
      )}
    </div>
  );
}

export function NavLink({ href, children, className = "", activeClass }: { href: string; children: React.ReactNode; className?: string; activeClass: string }) {
  const path = usePathname();
  const qs = useSearchParams();
  const [p, q] = href.split("?");
  const view = new URLSearchParams(q ?? "").get("view");
  const active = (path === p || path.startsWith(`${p}/`)) && (view ? qs.get("view") === view : p !== "/jobs" || !qs.get("view") || qs.get("view") === "jobs");
  return <Link href={href} aria-current={active ? "page" : undefined} className={`${className} ${active ? activeClass : ""}`}>{children}</Link>;
}

/** Shows a one-time link (invitation / review link) with copy and WhatsApp share. */
export function ShareLink({ link, label }: { link: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-green-300 bg-green-50 p-3" data-testid="share-link">
      <p className="text-sm font-bold text-green-900">{label}</p>
      <p className="mt-1 text-xs text-green-900">This link is shown only once. Copy it now if you want to send it yourself.</p>
      <input readOnly value={link} aria-label="Link" className="input mt-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>{copied ? "Copied" : "Copy link"}</button>
        <a className="btn btn-secondary btn-sm" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(link)}`}>Share on WhatsApp</a>
      </div>
    </div>
  );
}

/** Drawn signature → PNG data URL in a hidden input. Recorded as acknowledgement evidence only. */
export function SignaturePad({ name = "signature", label = "Signature", required = false, hint = "Sign above with your finger. This records your acknowledgement." }: { name?: string; label?: string; required?: boolean; hint?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [value, setValue] = useState("");
  const drawing = useRef(false);
  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * canvas.current!.width) / r.width, ((e.clientY - r.top) * canvas.current!.height) / r.height] as const;
  };
  const start = (e: React.PointerEvent) => {
    drawing.current = true;
    canvas.current!.setPointerCapture(e.pointerId);
    const c = canvas.current!.getContext("2d")!;
    c.lineWidth = 2.5; c.lineCap = "round"; c.strokeStyle = "#111827";
    c.beginPath(); c.moveTo(...pos(e));
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const c = canvas.current!.getContext("2d")!;
    c.lineTo(...pos(e)); c.stroke();
  };
  const end = () => { if (drawing.current) { drawing.current = false; setValue(canvas.current!.toDataURL("image/png")); } };
  const clear = () => { const c = canvas.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); setValue(""); };
  return (
    <div>
      <span className="label">{label}{required ? <span className="text-red-700"> *</span> : <span className="font-normal text-gray-600"> (optional)</span>}</span>
      <canvas ref={canvas} width={600} height={180} data-testid="signature-pad" aria-label="Signature area: sign with your finger or mouse"
        className="w-full touch-none rounded-md border-2 border-dashed border-gray-400 bg-white" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <input type="hidden" name={name} value={value} />
      <div className="mt-1 flex items-center justify-between">
        <p className="text-xs text-gray-600">{hint} The date and time are added automatically.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={clear}>Clear</button>
      </div>
    </div>
  );
}

/** Password input with a show/hide toggle (easier to type long passwords correctly on a phone). */
export function PasswordField({ label, name, hint, autoComplete, minLength }: { label: string; name: string; hint?: string; autoComplete: string; minLength?: number }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label className="label" htmlFor={name}>{label} <span className="text-red-700">*</span></label>
      <div className="relative">
        <input id={name} name={name} type={show ? "text" : "password"} required autoComplete={autoComplete} minLength={minLength} className="input pr-20" />
        <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show} aria-controls={name}
          className="absolute inset-y-0 right-0 my-1 mr-1 rounded px-3 text-sm font-semibold text-gray-700 hover:bg-gray-100">{show ? "Hide" : "Show"}</button>
      </div>
      {hint && <p className="mt-1 text-xs text-gray-600">{hint}</p>}
    </div>
  );
}
