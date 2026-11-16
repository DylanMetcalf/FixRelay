"use client";
import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/_lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Form bound to a server action: shows the returned error/success and disables submit while pending. */
export function Form({ action, children, className = "space-y-3", resetOnOk = false, hidden = {}, onOk }: {
  action: Action; children: React.ReactNode; className?: string; resetOnOk?: boolean;
  hidden?: Record<string, string>; onOk?: (data?: Record<string, string>) => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (resetOnOk) ref.current?.reset();
      onOk?.(state.data);
    }
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form ref={ref} action={formAction} className={className}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      {state?.error && <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{state.error}</p>}
      {state?.ok && !state.error && <p role="status" className="text-sm font-semibold text-green-800">{state.ok}</p>}
    </form>
  );
}

export function Submit({ children, className = "btn btn-primary", confirm }: { children: React.ReactNode; className?: string; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}
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
