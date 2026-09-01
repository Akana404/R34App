import { z } from "zod";
import { postSchema } from "@/lib/types";
import {
  MAX_BLOCKED_TAGS,
  MAX_DISMISSED,
  MAX_LIKES,
  MAX_SEEN,
  readPrefsSnapshot,
  writePrefsSnapshot,
  type LikedPost,
  type PrefsSnapshot,
} from "@/lib/prefs";

const APP = "r34-browser";
/** Bump when the payload shape changes incompatibly. */
const VERSION = 3;

const likedPostSchema = z.object({
  id: z.number(),
  tags: z.array(z.string()),
  score: z.number(),
  rating: z.string(),
  likedAt: z.number(),
  post: postSchema.optional(),
});

const dismissedPostSchema = z.object({
  id: z.number(),
  tags: z.array(z.string()),
  dismissedAt: z.number(),
});

const backupSchema = z.object({
  app: z.literal(APP),
  version: z.number(),
  exportedAt: z.string(),
  data: z.object({
    likes: z.array(likedPostSchema),
    seeds: z.array(z.string()),
    hideAi: z.boolean(),
    mobileColumns: z.union([z.literal(1), z.literal(2)]),
    // Added in v2; a v1 backup simply carries no negative signal.
    dismissed: z.array(dismissedPostSchema).optional().default([]),
    seen: z.array(z.number()).optional().default([]),
    // Added in v3, alongside the content filters.
    blocked: z.array(z.string()).optional().default([]),
    rating: z
      .enum(["", "safe", "questionable", "explicit"])
      .optional()
      .default(""),
  }),
});

export type Backup = z.infer<typeof backupSchema>;
export type ImportMode = "merge" | "replace";

export function fileName(date = new Date()): string {
  return `r34-browser-backup-${date.toISOString().slice(0, 10)}.json`;
}

/** Serializes the current localStorage state as a downloadable JSON string. */
export function serializeBackup(): string {
  const data = readPrefsSnapshot();
  const backup: Backup = {
    app: APP,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
  return JSON.stringify(backup, null, 2);
}

/** Throws an Error with a user-facing message when the file isn't usable. */
export function parseBackup(text: string): Backup {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const parsed = backupSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("That doesn't look like an R34 Browser backup.");
  }
  if (parsed.data.version > VERSION) {
    throw new Error(
      `This backup was written by a newer version (v${parsed.data.version}).`,
    );
  }
  return parsed.data;
}

/**
 * Union by post id, newest like wins — but an entry carrying the full post
 * beats one without it, since older likes were stored without it.
 */
export function mergeLikes(
  current: LikedPost[],
  incoming: LikedPost[],
): LikedPost[] {
  const byId = new Map<number, LikedPost>();
  for (const like of [...current, ...incoming]) {
    const existing = byId.get(like.id);
    if (!existing) {
      byId.set(like.id, like);
      continue;
    }
    const better =
      existing.post && !like.post
        ? existing
        : like.post && !existing.post
          ? like
          : like.likedAt > existing.likedAt
            ? like
            : existing;
    byId.set(like.id, better);
  }
  return [...byId.values()]
    .sort((a, b) => a.likedAt - b.likedAt)
    .slice(-MAX_LIKES);
}

/** Union of two id-keyed lists, oldest first, keeping the existing entry. */
function mergeById<T extends { id: number }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(incoming.map((entry) => [entry.id, entry]));
  for (const entry of current) byId.set(entry.id, entry);
  return [...byId.values()];
}

/** Applies a parsed backup and reports the resulting like count. */
export function applyBackup(backup: Backup, mode: ImportMode): PrefsSnapshot {
  const current = readPrefsSnapshot();
  const next: PrefsSnapshot =
    mode === "replace"
      ? backup.data
      : {
          likes: mergeLikes(current.likes, backup.data.likes),
          seeds: [...new Set([...current.seeds, ...backup.data.seeds])],
          hideAi: backup.data.hideAi,
          mobileColumns: backup.data.mobileColumns,
          dismissed: mergeById(current.dismissed, backup.data.dismissed).slice(
            -MAX_DISMISSED,
          ),
          seen: [...new Set([...current.seen, ...backup.data.seen])].slice(
            -MAX_SEEN,
          ),
          blocked: [
            ...new Set([...current.blocked, ...backup.data.blocked]),
          ].slice(0, MAX_BLOCKED_TAGS),
          rating: backup.data.rating,
        };
  if (!writePrefsSnapshot(next)) {
    throw new Error(
      "Not enough storage space — the import was rolled back.",
    );
  }
  return next;
}

/** Triggers a download of `text` without leaving the page. */
export function downloadJSON(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Opens the OS file picker and resolves with the file's text, or null. */
export function pickJSONFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, text: await file.text() } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
