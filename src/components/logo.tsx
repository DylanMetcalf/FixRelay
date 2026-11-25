/** ManOp logo: the mark (an M whose middle stroke is a check: reported → resolved) plus the wordmark "Man" + amber "Op". */
export function Logo({ size = 36, dark = true, className = "" }: { size?: number; dark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark size={size} />
      <span className={`font-extrabold tracking-tight ${dark ? "text-white" : "text-navy"}`} style={{ fontSize: size * 0.62 }}>
        Man<span className="text-signal">Op</span>
      </span>
    </span>
  );
}

/** The symbol on its navy tile. Same geometry as public/brand/manop-mark.svg. */
export function Mark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden className="shrink-0">
      <rect width="512" height="512" rx="112" fill="#0B1F3A" />
      <path d="M140 372V150l70 96" fill="none" stroke="#fff" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M210 246l52 70 110-176" fill="none" stroke="#F5A524" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M372 140v232" fill="none" stroke="#fff" strokeWidth="46" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="140" cy="372" r="25" fill="#5B8DEF" />
    </svg>
  );
}
