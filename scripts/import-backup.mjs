import fs from "node:fs";
import path from "node:path";
import { getDb } from "@/lib/db";
import {
  readLikePosts,
  readSnapshot,
  readTagMeta,
  replaceSnapshot,
} from "@/lib/store";

/**
 * One-off import of the data this app used to keep in browser localStorage.
 *
 * Usage: npm run import-backup -- old/backup.json
 *
 * Accepts either the backup envelope the old build exported
 * (`{ app, version, exportedAt, data: { … } }`) or a flat dump of the raw
 * localStorage keys, because either is a plausible way to have got the data
 * out. Every field is validated on its own and bad entries are dropped
 * individually — one unreadable like must not cost you the other 499.
 *
 * Always a full replace: this exists to cold-start the database, and the app
 * writes to it directly from then on.
 */

const LOCAL_STORAGE_KEYS = {
  likes: "forYou:likes",
  dismissed: "forYou:dismissed",
  seen: "forYou:seen",
  seeds: "forYou:seeds",
  blocked: "blockedTags",
  tagMeta: "tagMeta",
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** localStorage dumps often keep the values as their raw JSON strings. */
function decode(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asArray(value) {
  const decoded = decode(value);
  return Array.isArray(decoded) ? decoded : [];
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reduces both accepted shapes to the one the store understands. */
function normalize(input) {
  if (!isObject(input)) fail("That file doesn't contain a JSON object.");

  const source = isObject(input.data) ? input.data : input;
  const pick = (field) =>
    source[field] !== undefined
      ? source[field]
      : source[LOCAL_STORAGE_KEYS[field]];

  return {
    likes: asArray(pick("likes")).flatMap(readLike),
    dismissed: asArray(pick("dismissed")).flatMap(readDismissed),
    seen: asArray(pick("seen")).filter((id) => Number.isFinite(id)),
    seeds: asArray(pick("seeds")).filter((tag) => typeof tag === "string"),
    blocked: asArray(pick("blocked")).filter((tag) => typeof tag === "string"),
    tagMeta: readTagMetaEntries(pick("tagMeta")),
  };
}

function readTags(value) {
  if (Array.isArray(value)) return value.filter((tag) => typeof tag === "string");
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return [];
}

function readLike(entry) {
  if (!isObject(entry) || !Number.isFinite(entry.id)) return [];
  return [
    {
      id: entry.id,
      tags: readTags(entry.tags),
      score: Number.isFinite(entry.score) ? entry.score : 0,
      rating: typeof entry.rating === "string" ? entry.rating : "",
      likedAt: Number.isFinite(entry.likedAt) ? entry.likedAt : Date.now(),
      post: isObject(entry.post) ? entry.post : undefined,
    },
  ];
}

function readDismissed(entry) {
  if (!isObject(entry) || !Number.isFinite(entry.id)) return [];
  return [
    {
      id: entry.id,
      tags: readTags(entry.tags),
      dismissedAt: Number.isFinite(entry.dismissedAt)
        ? entry.dismissedAt
        : Date.now(),
    },
  ];
}

/** Tag metadata was stored either as [tag, count, category] or as an object. */
function readTagMetaEntries(value) {
  const decoded = decode(value);
  if (Array.isArray(decoded)) {
    return decoded.flatMap((entry) =>
      Array.isArray(entry) &&
      typeof entry[0] === "string" &&
      Number.isFinite(entry[1])
        ? [[entry[0], entry[1], String(entry[2] ?? "tag")]]
        : [],
    );
  }
  if (isObject(decoded)) {
    return Object.entries(decoded).flatMap(([tag, meta]) =>
      Array.isArray(meta) && Number.isFinite(meta[0])
        ? [[tag, meta[0], String(meta[1] ?? "tag")]]
        : [],
    );
  }
  return [];
}

const file = process.argv[2];
if (!file) fail("Usage: npm run import-backup -- <path to backup.json>");

const resolved = path.resolve(process.cwd(), file);
if (!fs.existsSync(resolved)) fail(`No such file: ${resolved}`);

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(resolved, "utf8"));
} catch (err) {
  fail(`That file isn't valid JSON: ${err.message}`);
}

const snapshot = normalize(parsed);
const total =
  snapshot.likes.length +
  snapshot.dismissed.length +
  snapshot.seen.length +
  snapshot.seeds.length +
  snapshot.blocked.length +
  snapshot.tagMeta.length;
if (total === 0) {
  fail(
    "Nothing recognisable in that file — expected a backup envelope or a dump of the localStorage keys.",
  );
}

const db = getDb();
replaceSnapshot(db, snapshot);

// Report what the store actually kept, not what the file offered: the caps
// and the blocked-tag rules run on write and can drop entries.
const stored = readSnapshot(db);

console.log(
  [
    `Imported into ${process.env.DB_PATH ?? "data/r34-browser.sqlite"}:`,
    `  ${stored.likes.length} likes (${readLikePosts(db).length} with a stored post)`,
    `  ${stored.dismissed.length} dismissals`,
    `  ${stored.seen.length} seen ids`,
    `  ${stored.seeds.length} seed tags`,
    `  ${stored.blocked.length} blocked tags`,
    `  ${readTagMeta(db).length} tag metadata entries`,
    "",
    "The hide-AI, rating and column settings stay per-browser — set them in the app.",
  ].join("\n"),
);
