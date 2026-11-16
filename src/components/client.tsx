"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
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
export function SignaturePad({ name = "signature" }: { name?: string }) {
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
      <span className="label">Signature</span>
      <canvas ref={canvas} width={600} height={180} data-testid="signature-pad" aria-label="Signature area: sign with your finger or mouse"
        className="w-full touch-none rounded-md border-2 border-dashed border-gray-400 bg-white" onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <input type="hidden" name={name} value={value} />
      <div className="mt-1 flex items-center justify-between">
        <p className="text-xs text-gray-600">Sign above with your finger. This records your acknowledgement.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={clear}>Clear</button>
      </div>
    </div>
  );
}
