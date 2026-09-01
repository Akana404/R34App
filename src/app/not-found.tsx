import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold text-neutral-100">Page not found</h1>
      <p className="text-sm text-neutral-400">
        There is nothing at this address.
      </p>
      <Link
        href="/"
        className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-200 hover:border-neutral-500"
      >
        Back to browsing
      </Link>
    </main>
  );
}
