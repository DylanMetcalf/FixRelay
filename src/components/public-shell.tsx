import { readableOn, safeColour } from "@/lib/colour";
import { Mark } from "./logo";

interface Org { name: string; brandColour: string; logoAttachmentId: string | null; phone?: string; contactEmail?: string }

/** Branded frame for public pages (contractor portal, public fault report). No app navigation, no account. */
export function PublicShell({ org, logoSrc, children }: { org: Org; logoSrc?: string | null; children: React.ReactNode }) {
  const brand = safeColour(org.brandColour);
  return (
    <div style={{ "--brand": brand, "--brand-fg": readableOn(brand) } as React.CSSProperties} className="min-h-dvh bg-mist">
      <header className="px-4 py-4" style={{ background: brand, color: readableOn(brand) }}>
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {logoSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} alt="" className="h-10 w-10 rounded bg-white object-contain" />
          )}
          <p className="text-lg font-extrabold">{org.name}</p>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">{children}</main>
      <footer className="mx-auto max-w-2xl px-4 pb-8 text-center text-xs text-gray-600">
        {org.name}{org.phone && ` · ${org.phone}`}{org.contactEmail && ` · ${org.contactEmail}`}
        <p className="mt-2 flex items-center justify-center gap-1.5"><Mark size={14} /> Maintenance managed with FixRelay</p>
      </footer>
    </div>
  );
}

export function PublicMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-navy p-4">
      <div className="card max-w-md text-center"><h1 className="text-xl font-extrabold">{title}</h1><div className="muted mt-2">{children}</div></div>
    </main>
  );
}
