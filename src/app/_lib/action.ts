import { AppError } from "@/lib/errors";

export type ActionState = { error?: string; ok?: string; data?: Record<string, string>; redirectTo?: string; at?: number } | null;
export type Outcome = { ok?: string; redirect?: string; data?: Record<string, string> } | void;

/**
 * Wraps every server action: business errors (AppError) become a message for the form;
 * anything else is logged and shown as a generic error (no internals leak to the browser).
 */
export async function run(fn: () => Promise<Outcome>): Promise<ActionState> {
  let out: Outcome;
  try {
    out = await fn();
  } catch (e) {
    if (e instanceof AppError) return { error: e.message };
    console.error("[action error]", e);
    return { error: "Something went wrong. Please try again." };
  }
  // Navigation happens in the browser (components/form.tsx). Server-side redirect()/revalidatePath() inside
  // actions left the client transition hanging in production builds of Next 15.5 (see AI_HANDOVER.md).
  return { ok: out?.ok ?? "Saved.", data: out?.data, redirectTo: out?.redirect, at: Date.now() };
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
export const list = (fd: FormData, k: string) => fd.getAll(k).map(String).filter(Boolean);

export async function fileOf(fd: FormData, k: string): Promise<{ filename: string; bytes: Buffer } | null> {
  const f = fd.get(k);
  if (!(f instanceof File) || f.size === 0) return null;
  return { filename: f.name, bytes: Buffer.from(await f.arrayBuffer()) };
}
export async function filesOf(fd: FormData, k: string) {
  const out: { filename: string; bytes: Buffer }[] = [];
  for (const f of fd.getAll(k)) if (f instanceof File && f.size > 0) out.push({ filename: f.name, bytes: Buffer.from(await f.arrayBuffer()) });
  return out;
}
