"use client";

import { useCallback, useMemo, useState } from "react";
import { MasonryColumns } from "@/components/MasonryColumns";
import { AppHeader } from "@/components/AppHeader";
import { ImportDialog } from "@/components/ImportDialog";
import { DownloadIcon, SortIcon, UploadIcon } from "@/components/icons";
import {
  applyBackup,
  downloadJSON,
  fileName,
  parseBackup,
  pickJSONFile,
  serializeBackup,
  type Backup,
  type ImportMode,
} from "@/lib/backup";
import { MAX_LIKES, useLikes, useMobileColumns } from "@/lib/prefs";

const BUTTON =
  "flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm whitespace-nowrap text-neutral-300 hover:border-neutral-500 sm:min-h-0 sm:w-auto sm:py-1.5";

export function LikesView() {
  const { likes } = useLikes();
  const [mobileColumns] = useMobileColumns();
  // The import confirmation lives here, not in the buttons: AppHeader renders
  // its `controls` twice (inline + inside the mobile sheet).
  const [pending, setPending] = useState<{ backup: Backup; name: string } | null>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [oldestFirst, setOldestFirst] = useState(false);

  // Older likes (before the full post was stored) can't be rendered, but
  // still count toward recommendations.
  const posts = useMemo(() => {
    const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
    return likes
      .filter((like) => like.post)
      .filter(
        (like) =>
          terms.length === 0 ||
          terms.every((term) =>
            like.tags.some((tag) => tag.toLowerCase().includes(term)),
          ),
      )
      .sort((a, b) =>
        oldestFirst ? a.likedAt - b.likedAt : b.likedAt - a.likedAt,
      )
      .map((like) => like.post!);
  }, [likes, filter, oldestFirst]);
  const hiddenCount = filter
    ? 0
    : likes.length - posts.length;
  // The store drops the oldest like once it is full; say so before it bites.
  const nearCap = likes.length >= MAX_LIKES * 0.9;

  const onExport = useCallback(() => {
    downloadJSON(serializeBackup(), fileName());
    setStatus(`Exported ${likes.length} like${likes.length === 1 ? "" : "s"}.`);
  }, [likes.length]);

  const onImport = useCallback(async () => {
    setStatus(null);
    const file = await pickJSONFile();
    if (!file) return;
    try {
      setPending({ backup: parseBackup(file.text), name: file.name });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Import failed.");
    }
  }, []);

  const onConfirm = useCallback(
    (mode: ImportMode) => {
      if (!pending) return;
      setPending(null);
      try {
        const next = applyBackup(pending.backup, mode);
        setStatus(
          `${mode === "merge" ? "Merged" : "Replaced"} — ${next.likes.length} like${
            next.likes.length === 1 ? "" : "s"
          } now stored.`,
        );
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Import failed.");
      }
    },
    [pending],
  );

  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 pb-24 sm:pb-12">
      <AppHeader
        search={
          likes.length > 0 ? (
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by tag…"
              aria-label="Filter likes by tag"
              className="w-full max-w-3xl min-w-0 rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-base outline-none placeholder:text-neutral-500 focus:border-neutral-500 sm:text-sm"
            />
          ) : undefined
        }
        aside={
          <p className="text-sm text-neutral-500 sm:ml-auto">
            {likes.length} liked post{likes.length === 1 ? "" : "s"}
            {hiddenCount > 0 && (
              <>
                {" "}
                <span className="sm:hidden">· +{hiddenCount} older</span>
                <span className="hidden sm:inline">
                  — {hiddenCount} older like{hiddenCount === 1 ? "" : "s"} can&apos;t
                  be displayed (still counted for recommendations)
                </span>
              </>
            )}
          </p>
        }
        controls={
          <>
            <button
              onClick={() => setOldestFirst((v) => !v)}
              aria-pressed={oldestFirst}
              title="Flip the sort order"
              className={BUTTON}
            >
              <SortIcon className="size-4" />
              {oldestFirst ? "Oldest first" : "Newest first"}
            </button>
            <button data-sheet-close onClick={onExport} className={BUTTON}>
              <DownloadIcon className="size-4" />
              Export
            </button>
            <button data-sheet-close onClick={onImport} className={BUTTON}>
              <UploadIcon className="size-4" />
              Import
            </button>
          </>
        }
      />

      {nearCap && (
        <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {likes.length} of {MAX_LIKES} likes stored. At the limit the oldest
          like is dropped for each new one — export a backup to keep them.
        </p>
      )}

      {status && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm text-neutral-300"
        >
          {status}
        </p>
      )}

      {posts.length > 0 ? (
        <MasonryColumns posts={posts} mobileColumns={mobileColumns} />
      ) : (
        <p className="py-16 text-center text-neutral-500">
          {filter
            ? `No liked posts match “${filter}”.`
            : "Nothing here yet — like posts while browsing and they'll show up here."}
        </p>
      )}

      {pending && (
        <ImportDialog
          backup={pending.backup}
          fileName={pending.name}
          currentLikes={likes.length}
          onConfirm={onConfirm}
          onCancel={() => setPending(null)}
        />
      )}
    </main>
  );
}
