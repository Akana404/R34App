import type {
  AppSnapshot,
  DismissedPost,
  LikedPost,
  TagMetaEntry,
} from "@/lib/state";
import { postSchema } from "@/lib/types";

/**
 * The backup file format, and the one parser that reads it.
 *
 * Shared by the in-app import (`/api/backup`) and the cold-start CLI
 * (`scripts/import-backup.mjs`), so a file the app exports is always a file
 * either of them can read. Free of server imports and of `"use client"`.
 *
 * Reading is deliberately forgiving: every field is validated on its own and
 * bad entries are dropped individually — one unreadable like must not cost
 * you the other 499.
 */

export const BACKUP_APP = "r34-browser";
export const BACKUP_VERSION = 2;

/** What an export carries: the state you built, not the caches that rebuild. */
export type BackupContent = Omit<AppSnapshot, "seen">;

export interface BackupEnvelope {
  app: typeof BACKUP_APP;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: BackupContent;
}

export interface NormalizedBackup {
  likes: LikedPost[];
  dismissed: DismissedPost[];
  seen: number[];
  seeds: string[];
  blocked: string[];
  tagMeta: TagMetaEntry[];
}

type Field = keyof NormalizedBackup;

/** Keys the old localStorage build kept each field under. */
const LOCAL_STORAGE_KEYS: Record<Field, string> = {
  likes: "forYou:likes",
  dismissed: "forYou:dismissed",
  seen: "forYou:seen",
  seeds: "forYou:seeds",
  blocked: "blockedTags",
  tagMeta: "tagMeta",
};

const CONTENT_FIELDS: Field[] = ["likes", "dismissed", "seeds", "blocked"];

export function buildExport(
  content: BackupContent,
  now = new Date(),
): BackupEnvelope {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    data: {
      likes: content.likes,
      dismissed: content.dismissed,
      seeds: content.seeds,
      blocked: content.blocked,
    },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** localStorage dumps often keep the values as their raw JSON strings. */
function decode(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asArray(value: unknown): unknown[] {
  const decoded = decode(value);
  return Array.isArray(decoded) ? decoded : [];
}

function readTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((tag): tag is string => typeof tag === "string");
  }
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return [];
}

function readLike(entry: unknown, now: number): LikedPost[] {
  if (!isObject(entry) || !isFiniteNumber(entry.id)) return [];
  // A post that doesn't validate costs the like its picture, not its place.
  const post = postSchema.safeParse(entry.post);
  return [
    {
      id: entry.id,
      tags: readTags(entry.tags),
      score: isFiniteNumber(entry.score) ? entry.score : 0,
      rating: typeof entry.rating === "string" ? entry.rating : "",
      likedAt: isFiniteNumber(entry.likedAt) ? entry.likedAt : now,
      post: post.success ? post.data : undefined,
    },
  ];
}

function readDismissed(entry: unknown, now: number): DismissedPost[] {
  if (!isObject(entry) || !isFiniteNumber(entry.id)) return [];
  return [
    {
      id: entry.id,
      tags: readTags(entry.tags),
      dismissedAt: isFiniteNumber(entry.dismissedAt) ? entry.dismissedAt : now,
    },
  ];
}

/** Tag metadata was stored either as [tag, count, category] or as an object. */
function readTagMetaEntries(value: unknown): TagMetaEntry[] {
  const decoded = decode(value);
  if (Array.isArray(decoded)) {
    return decoded.flatMap((entry): TagMetaEntry[] =>
      Array.isArray(entry) &&
      typeof entry[0] === "string" &&
      isFiniteNumber(entry[1])
        ? [[entry[0], entry[1], String(entry[2] ?? "tag")]]
        : [],
    );
  }
  if (isObject(decoded)) {
    return Object.entries(decoded).flatMap(([tag, meta]): TagMetaEntry[] =>
      Array.isArray(meta) && isFiniteNumber(meta[0])
        ? [[tag, meta[0], String(meta[1] ?? "tag")]]
        : [],
    );
  }
  return [];
}

/**
 * Reduces a backup envelope (this app's export, or the old localStorage
 * build's) or a flat dump of the raw localStorage keys to one shape.
 *
 * `present` lists the fields the input actually named, which is how a caller
 * tells "a backup of an empty store" from "some unrelated JSON" — the latter
 * comes back as null.
 */
export function normalizeBackup(
  input: unknown,
): { backup: NormalizedBackup; present: Field[] } | null {
  if (!isObject(input)) return null;

  const source = isObject(input.data) ? input.data : input;
  const pick = (field: Field) =>
    source[field] !== undefined
      ? source[field]
      : source[LOCAL_STORAGE_KEYS[field]];

  const present = (Object.keys(LOCAL_STORAGE_KEYS) as Field[]).filter(
    (field) => pick(field) !== undefined,
  );
  if (present.length === 0) return null;

  const now = Date.now();
  return {
    present,
    backup: {
      likes: asArray(pick("likes")).flatMap((entry) => readLike(entry, now)),
      dismissed: asArray(pick("dismissed")).flatMap((entry) =>
        readDismissed(entry, now),
      ),
      seen: asArray(pick("seen")).filter(isFiniteNumber),
      seeds: asArray(pick("seeds")).filter(
        (tag): tag is string => typeof tag === "string",
      ),
      blocked: asArray(pick("blocked")).filter(
        (tag): tag is string => typeof tag === "string",
      ),
      tagMeta: readTagMetaEntries(pick("tagMeta")),
    },
  };
}

/** True when the input names at least one field an in-app import restores. */
export function hasBackupContent(present: Field[]): boolean {
  return present.some((field) => CONTENT_FIELDS.includes(field));
}
