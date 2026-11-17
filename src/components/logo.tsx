/** FixRelay logo: the mark (fault dot → F route → done check) plus wordmark. */
export function Logo({ size = 36, dark = true, className = "" }: { size?: number; dark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={size} />
      <span className={`font-extrabold tracking-tight ${dark ? "text-white" : "text-navy"}`} style={{ fontSize: size * 0.62 }}>
        Fix<span className="text-signal">Relay</span>
      </span>
    </span>
  );
}

export function Mark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden className="shrink-0">
      <rect width="512" height="512" rx="112" fill="#0B1F3A" />
      <path d="M160 352V214a64 64 0 0 1 64-64h86" fill="none" stroke="#fff" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M160 258h92" fill="none" stroke="#fff" strokeWidth="44" strokeLinecap="round" />
      <circle cx="160" cy="370" r="30" fill="#5B8DEF" />
      <circle cx="368" cy="150" r="58" fill="#F5A524" />
      <path d="M342 151l18 18 34-36" fill="none" stroke="#0B1F3A" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
