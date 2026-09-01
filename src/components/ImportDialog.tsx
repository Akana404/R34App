"use client";

import { useEffect, useRef } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";
import type { Backup, ImportMode } from "@/lib/backup";

interface ImportDialogProps {
  backup: Backup;
  fileName: string;
  currentLikes: number;
  onConfirm: (mode: ImportMode) => void;
  onCancel: () => void;
}

/** Confirms what a backup contains before anything is written. */
export function ImportDialog({
  backup,
  fileName,
  currentLikes,
  onConfirm,
  onCancel,
}: ImportDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { likes, seeds } = backup.data;
  useFocusTrap(panelRef);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        className="absolute inset-0 h-full w-full bg-black/60"
        aria-label="Cancel import"
        onClick={onCancel}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Import data"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-t-2xl border border-neutral-800 bg-neutral-900 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:rounded-2xl sm:pb-5"
      >
        <h2 className="text-base font-semibold text-neutral-100">Import data</h2>
        <p className="mt-1 truncate text-sm text-neutral-500">{fileName}</p>

        <dl className="mt-4 space-y-1 text-sm text-neutral-300">
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-500">Likes in file</dt>
            <dd>{likes.length}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-500">Seed tags in file</dt>
            <dd>{seeds.length}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-500">Likes you have now</dt>
            <dd>{currentLikes}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-neutral-500">Exported</dt>
            <dd>{new Date(backup.exportedAt).toLocaleDateString()}</dd>
          </div>
        </dl>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => onConfirm("merge")}
            className="min-h-11 flex-1 rounded-lg border border-indigo-500/60 bg-indigo-600/30 px-3 text-sm text-indigo-100 hover:bg-indigo-600/40"
          >
            Merge with current
          </button>
          <button
            onClick={() => onConfirm("replace")}
            className="min-h-11 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-300 hover:border-neutral-500"
          >
            Replace all
          </button>
        </div>
        <button
          onClick={onCancel}
          className="mt-2 min-h-11 w-full rounded-lg px-3 text-sm text-neutral-500 hover:text-neutral-300"
        >
          Cancel
        </button>
        <p className="mt-3 text-xs text-neutral-500">
          Replace discards likes and seed tags that aren&apos;t in the file.
        </p>
      </div>
    </div>
  );
}
