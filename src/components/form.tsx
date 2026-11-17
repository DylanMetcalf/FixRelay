"use client";
import { createContext, startTransition, useActionState, useContext, useEffect, useState } from "react";
import type { ActionState } from "@/app/_lib/action";

const Pending = createContext(false);

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Form bound to a server action: shows the returned error/success and disables submit while pending. */
export function Form({ action, children, className = "space-y-3", hidden = {}, onOk }: {
  action: Action; children: React.ReactNode; className?: string;
  hidden?: Record<string, string>; onOk?: (data?: Record<string, string>) => void;
}) {
  // Submitted via onSubmit + startTransition (not <form action>), because React 19 clears every field after
  // a form action, even a FAILED one: users would lose what they typed whenever validation rejected it.
  const [state, formAction, pending] = useActionState(action, null);
  const ready = useHydrated();
  useEffect(() => {
    if (!state?.ok) return;
    onOk?.(state.data);
    // Full page loads instead of router.refresh()/push(): in production builds of Next 15.5 the router's
    // RSC fetches after a server action were intermittently cancelled, leaving stale pages (see AI_HANDOVER.md).
    if (state.redirectTo) return window.location.assign(state.redirectTo);
    if (state.data?.link || state.data?.sent) return; // keep the one-time link / confirmation on screen
    try { sessionStorage.setItem("fr_flash", state.ok ?? "Saved."); } catch { /* storage blocked: reload anyway */ }
    window.location.reload();
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(fd));
  };
  return (
    // action={formAction}: before JavaScript has loaded, the browser POSTs straight to the server action (never a
    // GET with fields such as passwords in the URL). Once hydrated, onSubmit takes over (preventDefault stops
    // React's own form-action path, which would clear the fields).
    <form action={formAction} method="post" onSubmit={onSubmit} className={className} aria-busy={pending}>
      <Pending.Provider value={pending}>
      {/* Fields stay read-only until React has hydrated: React 19 replaces values typed before hydration, so
          a fast typist on a slow phone would otherwise lose their input. Usually well under a second. */}
      <fieldset disabled={!ready} className="contents">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      </fieldset>
      {state?.error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{state.error}</p>}
      {state?.ok && !state.error && (state.data?.link || state.data?.sent) && <p role="status" className="text-sm font-semibold text-green-800">{state.ok}</p>}
      </Pending.Provider>
    </form>
  );
}

/** True once React has hydrated the page (buttons are disabled until then so early taps cannot half-submit). */
export function useHydrated() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready;
}

export function Submit({ children, className = "btn btn-primary", confirm }: { children: React.ReactNode; className?: string; confirm?: string }) {
  const pending = useContext(Pending);
  const ready = useHydrated();
  return (
    <button type="submit" disabled={pending || !ready} className={className}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}>
      {pending ? "Working…" : children}
    </button>
  );
}

/** One-button action (e.g. "Start work"). */
export function ActionButton({ action, hidden, children, className, confirm }: {
  action: Action; hidden: Record<string, string>; children: React.ReactNode; className?: string; confirm?: string;
}) {
  return <Form action={action} hidden={hidden} className="inline-block"><Submit className={className} confirm={confirm}>{children}</Submit></Form>;
}

/** Shows the success message carried across the post-action reload. */
export function Flash() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    try { const m = sessionStorage.getItem("fr_flash"); if (m) { sessionStorage.removeItem("fr_flash"); setMsg(m); setTimeout(() => setMsg(null), 6000); } } catch { /* ignore */ }
  }, []);
  if (!msg) return null;
  return <div role="status" className="no-print fixed inset-x-4 top-16 z-50 mx-auto max-w-md rounded-md bg-green-800 px-4 py-3 text-sm font-bold text-white shadow-lg">{msg}</div>;
}
