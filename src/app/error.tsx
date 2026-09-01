"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold text-neutral-100">
        Something went wrong
      </h1>
      <p className="text-sm text-neutral-400">
        The page hit an unexpected error. Your likes and settings are safe.
      </p>
      <button
        onClick={reset}
        className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-200 hover:border-neutral-500"
      >
        Try again
      </button>
    </main>
  );
}
