import Link from "@/components/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-4">
      <div className="card max-w-md text-center">
        <h1 className="text-xl font-extrabold">Not found</h1>
        <p className="muted mt-2">This page does not exist, or you do not have access to it.</p>
        <Link className="btn btn-primary mt-4" href="/dashboard">Go to dashboard</Link>
      </div>
    </main>
  );
}
