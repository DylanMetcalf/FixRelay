import { logoutAction } from "@/app/actions/auth";

export default function NoAccess() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-900 p-4">
      <div className="card max-w-md text-center">
        <h1 className="text-xl font-extrabold">No company access</h1>
        <p className="muted mt-2">Your account is not linked to an active company. If your access was removed, contact your company administrator.</p>
        <form action={logoutAction}><button className="btn btn-secondary mt-4">Sign out</button></form>
      </div>
    </main>
  );
}
