import fs from "node:fs";
import path from "node:path";
import { normalizeBackup } from "@/lib/backup";
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
 * Accepts either a backup envelope (`{ app, version, exportedAt, data: { … } }`,
 * from the old build or from this app's own export) or a flat dump of the raw
 * localStorage keys. The parser is shared with the in-app import
 * (`src/lib/backup.ts`) and drops bad entries individually — one unreadable
 * like must not cost you the other 499.
 *
 * Always a full replace, seen ids included: this exists to cold-start the
 * database. For everyday backups use Export/Import on the Liked page.
 */

function fail(message) {
  console.error(message);
  process.exit(1);
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

const snapshot = normalizeBackup(parsed)?.backup;
const total =
  !snapshot ? 0 :
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
