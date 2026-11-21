/**
 * Simple, explainable duplicate detection for new fault reports. No machine learning: a report is flagged when it
 * is at the same site, recent or still open, and shares the place, machine and enough words with another job.
 * Flags are only suggestions for a manager; nothing is merged or deleted automatically.
 */

const STOP = new Set(("the and for with from that this there have has was were are not but its it's into onto when then than they them " +
  "very just still again also some been being our your their near next off out over under after before about please there's isn't won't " +
  "can't doesn't don't keeps keep getting gets got one two all any").split(" "));

/** Lower-case words of 3+ letters without common filler words; plural "s" and "ing"/"ed" endings removed. */
export function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(raw.replace(/(ing|ed|es|s)$/, "") || raw);
  }
  return out;
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common); // Jaccard
}

export interface DupInput { id: string; title: string; description: string; locationId: string | null; assetId: string | null; category: string; reportedAt: Date }

/** Score 0..1 and the reason, or null when the two reports are clearly about different things. */
export function duplicateScore(n: DupInput, o: DupInput): { score: number; reasons: string[] } | null {
  if (n.locationId && o.locationId && n.locationId !== o.locationId) return null; // different areas
  if (n.assetId && o.assetId && n.assetId !== o.assetId) return null; // different machines
  const text = similarity(words(`${n.title} ${n.description}`), words(`${o.title} ${o.description}`));
  const reasons: string[] = [];
  let score = text * 0.6;
  if (text >= 0.2) reasons.push("similar description");
  if (n.assetId && n.assetId === o.assetId) { score += 0.35; reasons.push("same equipment"); }
  else if (n.locationId && n.locationId === o.locationId) { score += 0.2; reasons.push("same area"); }
  if (n.category !== "General" && n.category === o.category) score += 0.05;
  const hours = Math.abs(n.reportedAt.getTime() - o.reportedAt.getTime()) / 3_600_000;
  if (hours <= 48) { score += 0.1; reasons.push("reported within 2 days"); }
  return { score: Math.min(1, score), reasons };
}

export const DUPLICATE_THRESHOLD = 0.4;

/** The (up to three) most likely originals for a new report. */
export function findLikelyDuplicates(n: DupInput, candidates: DupInput[]): { id: string; score: number; reasons: string[] }[] {
  return candidates
    .filter((c) => c.id !== n.id)
    .map((c) => ({ id: c.id, r: duplicateScore(n, c) }))
    .filter((x): x is { id: string; r: { score: number; reasons: string[] } } => !!x.r && x.r.score >= DUPLICATE_THRESHOLD && x.r.reasons.includes("similar description"))
    .sort((a, b) => b.r.score - a.r.score)
    .slice(0, 3)
    .map((x) => ({ id: x.id, score: Math.round(x.r.score * 100) / 100, reasons: x.r.reasons }));
}
