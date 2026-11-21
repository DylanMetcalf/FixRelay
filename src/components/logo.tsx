/** Resultra logo: the mark (an R whose leg becomes a check: reported → resolved) plus the wordmark. */
export function Logo({ size = 36, dark = true, className = "" }: { size?: number; dark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={size} />
      <span className={`font-extrabold tracking-tight ${dark ? "text-white" : "text-navy"}`} style={{ fontSize: size * 0.62 }}>
        Resultra
      </span>
    </span>
  );
}

/** The symbol on its navy tile. Same geometry as public/brand/resultra-mark.svg. */
export function Mark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden className="shrink-0">
      <rect width="512" height="512" rx="112" fill="#0B1F3A" />
      <path d="M156 372V140h96a62 62 0 0 1 0 124h-96" fill="none" stroke="#fff" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M232 268l64 92 92-140" fill="none" stroke="#F5A524" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="156" cy="372" r="25" fill="#5B8DEF" />
    </svg>
  );
}
