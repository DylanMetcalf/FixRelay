"use client";

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-md text-center" role="alert">
      <h1 className="text-xl font-extrabold">Something went wrong</h1>
      <p className="muted mt-2">The page could not be loaded. Your data is safe. Please try again.</p>
      <button className="btn btn-primary mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
