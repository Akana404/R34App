"use client";

import { useRef, useState } from "react";
import { DownloadIcon, UploadIcon } from "@/components/icons";

const BUTTON =
  "flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm whitespace-nowrap text-neutral-300 hover:border-neutral-500 disabled:opacity-50 sm:min-h-0 sm:w-auto sm:py-1.5";

const ERRORS: Record<number, string> = {
  400: "That file isn't valid JSON.",
  413: "That file is too large to be a backup.",
  422: "Nothing recognisable in that file.",
};

/**
 * Export and import of likes, dismissals, seed and blocked tags as one JSON
 * file (`/api/backup`). An import replaces the store and then reloads the
 * page: the client mirror in `prefs.ts` only takes the first snapshot of a
 * page load, so a reload is what brings every view onto the imported state.
 */
export function BackupControls() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function importFile(file: File) {
    const confirmed = window.confirm(
      "Importing replaces all likes, dismissals, seed tags and blocked tags with the contents of this file. Continue?",
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: await file.text(),
      });
      if (!res.ok) {
        setMessage(ERRORS[res.status] ?? "The import couldn't be saved.");
        return;
      }
      const counts = (await res.json()) as { likes: number };
      setMessage(`Imported ${counts.likes} likes — reloading…`);
      window.location.reload();
    } catch {
      setMessage("The import couldn't be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a href="/api/backup" download className={BUTTON}>
        <DownloadIcon className="size-4" />
        Export
      </a>
      <button
        onClick={() => input.current?.click()}
        disabled={busy}
        title="Replace your data with a backup file"
        className={BUTTON}
      >
        <UploadIcon className="size-4" />
        {busy ? "Importing…" : "Import"}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        aria-label="Backup file to import"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Cleared so picking the same file again still fires a change.
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />
      {message && (
        <p role="status" className="text-sm text-neutral-400">
          {message}
        </p>
      )}
    </>
  );
}
