import { readableOn, safeColour } from "@/lib/colour";

interface Org { name: string; brandColour: string; logoAttachmentId: string | null; phone: string; contactEmail: string; vatRegistered: boolean; vatNumber: string }

/** Branded frame for public customer review pages (no app navigation, no account needed). */
export function ReviewShell({ org, token, children }: { org: Org; token: string; children: React.ReactNode }) {
  const brand = safeColour(org.brandColour);
  return (
    <div style={{ "--brand": brand, "--brand-fg": readableOn(brand) } as React.CSSProperties} className="min-h-dvh bg-gray-100">
      <header className="px-4 py-4" style={{ background: brand, color: readableOn(brand) }}>
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {org.logoAttachmentId && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/public/files/${token}/${org.logoAttachmentId}`} alt="" className="h-10 w-10 rounded bg-white object-contain" />
          )}
          <p className="text-lg font-extrabold">{org.name}</p>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">{children}</main>
      <footer className="mx-auto max-w-2xl px-4 pb-8 text-center text-xs text-gray-600">
        {org.name}{org.phone && ` · ${org.phone}`}{org.contactEmail && ` · ${org.contactEmail}`}{org.vatRegistered && org.vatNumber && ` · VAT no. ${org.vatNumber}`}
        <br />Sent securely with FixRelay. Do not forward this link: it is personal to you.
      </footer>
    </div>
  );
}

export function ReviewMessage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-900 p-4">
      <div className="card max-w-md text-center"><h1 className="text-xl font-extrabold">{title}</h1><p className="muted mt-2">{children}</p></div>
    </main>
  );
}
