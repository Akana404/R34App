import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

/**
 * The SQLite file behind everything the app remembers.
 *
 * Server-only: `better-sqlite3` is a native module and is listed in
 * `serverExternalPackages` so Next leaves it as a plain require.
 *
 * There is no migration framework on purpose — one local file, one owner, so
 * `CREATE TABLE IF NOT EXISTS` is the whole story. A later breaking schema
 * change (a new NOT NULL column, say) needs an ALTER written by hand.
 */

export class DbError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DbError";
  }
}

const DEFAULT_PATH = "data/r34-browser.sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS likes (
  id       INTEGER PRIMARY KEY,
  tags     TEXT    NOT NULL,
  score    INTEGER NOT NULL,
  rating   TEXT    NOT NULL,
  liked_at INTEGER NOT NULL,
  post     TEXT
);
CREATE INDEX IF NOT EXISTS likes_liked_at_idx ON likes(liked_at);

CREATE TABLE IF NOT EXISTS dismissed (
  id           INTEGER PRIMARY KEY,
  tags         TEXT    NOT NULL,
  dismissed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dismissed_at_idx ON dismissed(dismissed_at);

CREATE TABLE IF NOT EXISTS seen (
  id  INTEGER PRIMARY KEY,
  ord INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS seen_ord_idx ON seen(ord);

CREATE TABLE IF NOT EXISTS seeds (
  tag TEXT    PRIMARY KEY,
  ord INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blocked_tags (
  tag TEXT    PRIMARY KEY,
  ord INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tag_meta (
  tag      TEXT    PRIMARY KEY,
  count    INTEGER NOT NULL,
  category TEXT    NOT NULL,
  touched  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS tag_meta_touched_idx ON tag_meta(touched);
`;

export type Db = Database.Database;

/** Brings a fresh or existing database up to the current schema. */
export function createSchema(db: Db): Db {
  db.exec(SCHEMA);
  return db;
}

let cached: Db | null = null;

/**
 * The process-wide database handle. Opened lazily so importing this module
 * never touches the filesystem — the env var is read here, not at load time.
 */
export function getDb(): Db {
  if (cached) return cached;
  // The path is configurable, which Turbopack can't trace statically — it
  // would otherwise pull the whole project into the server bundle just in
  // case. Nothing here reads app source, so tracing has nothing to find.
  const file = path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.DB_PATH ?? DEFAULT_PATH,
  );
  try {
    // `data/` doesn't exist on a fresh checkout.
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new Database(file);
    // WAL lets a second browser read while the first one is writing.
    db.pragma("journal_mode = WAL");
    cached = createSchema(db);
    return cached;
  } catch (err) {
    throw new DbError(`could not open the database at ${file}`, { cause: err });
  }
}
