"use client";
import { useRef, useState } from "react";

/** Shows the PDF in a frame (computers and tablets) with Print / Download. Phones get buttons: their browsers open PDFs full screen. */
export function CardViewer({ src, autoPrint }: { src: string; autoPrint: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const print = () => {
    try { frame.current?.contentWindow?.focus(); frame.current?.contentWindow?.print(); }
    catch { window.open(src, "_blank", "noopener"); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" data-testid="card-controls">
        <button type="button" className="btn btn-primary hidden md:inline-flex" onClick={print}>Print</button>
        <a href={`${src}?download=1`} className="btn btn-secondary" download>Download PDF</a>
        <a href={src} target="_blank" rel="noopener" className="btn btn-secondary">Open in a new tab</a>
        <span className="text-sm text-gray-600" role="status">{state === "loading" ? "Preparing the job card… (Download PDF always works)" : state === "error" ? "The job card could not be loaded. Try Download PDF." : "Snapshot of the job as it is now."}</span>
      </div>
      <iframe ref={frame} src={src} title="Job card PDF" data-testid="card-frame"
        className="hidden h-[80vh] w-full rounded-lg border border-gray-300 bg-white md:block"
        onLoad={() => { setState("ready"); if (autoPrint) setTimeout(print, 400); }} onError={() => setState("error")} />
      <p className="text-sm text-gray-700 md:hidden">On a phone, tap <strong>Open in a new tab</strong> to view or print the job card, or <strong>Download PDF</strong> to save it.</p>
    </div>
  );
}
