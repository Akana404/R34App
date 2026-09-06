import type { Db } from "@/lib/db";
import {
  MAX_BLOCKED_TAGS,
  MAX_DISMISSED,
  MAX_LIKES,
  MAX_SEEN,
  MAX_TAGS,
  sanitizeBlockedTags,
  tagsOf,
  type AppSnapshot,
  type DismissedPost,
  type LikedPost,
} from "@/lib/state";
import { postSchema, type Post, type TagInfo } from "@/lib/types";

/**
 * Every read and write against the store, as plain functions over a database
 * handle. Nothing here knows about Next, so the tests run the real SQL
 * against an in-memory database and the API route stays a thin wrapper.
 *
 * Caps are enforced here, in SQL, inside the same transaction as the write
 * they belong to — a crash between the insert and the trim must not be able
 * to leave the store above its limit.
 */

interface LikeRow {
  id: number;
  tags: string;
  score: number;
  rating: string;
  liked_at: number;
}

interface DismissedRow {
  id: number;
  tags: string;
  dismissed_at: number;
}

/** Tags round-trip as JSON; a corrupted row loses its tags, not the whole read. */
function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((tag) => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

/** Oldest first, matching the append order the feed and the taste profile expect. */
export function readLikes(db: Db): LikedPost[] {
  const rows = db
    .prepare(
      "SELECT id, tags, score, rating, liked_at FROM likes ORDER BY liked_at, id",
    )
    .all() as LikeRow[];
  return rows.map((row) => ({
    id: row.id,
    tags: parseTags(row.tags),
    score: row.score,
    rating: row.rating,
    likedAt: row.liked_at,
  }));
}

export function readDismissed(db: Db): DismissedPost[] {
  const rows = db
    .prepare(
      "SELECT id, tags, dismissed_at FROM dismissed ORDER BY dismissed_at, id",
    )
    .all() as DismissedRow[];
  return rows.map((row) => ({
    id: row.id,
    tags: parseTags(row.tags),
    dismissedAt: row.dismissed_at,
  }));
}

export function readSeen(db: Db): number[] {
  const rows = db.prepare("SELECT id FROM seen ORDER BY ord, id").all() as {
    id: number;
  }[];
  return rows.map((row) => row.id);
}

export function readSeeds(db: Db): string[] {
  const rows = db.prepare("SELECT tag FROM seeds ORDER BY ord").all() as {
    tag: string;
  }[];
  return rows.map((row) => row.tag);
}

export function readBlockedTags(db: Db): string[] {
  const rows = db
    .prepare("SELECT tag FROM blocked_tags ORDER BY ord")
    .all() as { tag: string }[];
  return rows.map((row) => row.tag);
}

/** The light state every page needs synchronously — no post blobs, no tag meta. */
export function readSnapshot(db: Db): AppSnapshot {
  return {
    likes: readLikes(db),
    dismissed: readDismissed(db),
    seen: readSeen(db),
    seeds: readSeeds(db),
    blocked: readBlockedTags(db),
  };
}

/**
 * The full posts behind the likes, for the Liked view. Validated per row, so
 * one unreadable blob costs that post its picture and nothing else.
 */
export function readLikePosts(db: Db): Post[] {
  const rows = db
    .prepare(
      "SELECT post FROM likes WHERE post IS NOT NULL ORDER BY liked_at, id",
    )
    .all() as { post: string }[];
  return rows.flatMap((row) => {
    try {
      const parsed = postSchema.safeParse(JSON.parse(row.post));
      return parsed.success ? [parsed.data] : [];
    } catch {
      return [];
    }
  });
}

export type TagMetaEntry = [tag: string, count: number, category: string];

export function readTagMeta(db: Db): TagMetaEntry[] {
  const rows = db
    .prepare("SELECT tag, count, category FROM tag_meta ORDER BY touched")
    .all() as { tag: string; count: number; category: string }[];
  return rows.map((row) => [row.tag, row.count, row.category]);
}

/**
 * Next value of a monotonic ordering column. A counter rather than a
 * timestamp: entries written in the same millisecond still need a strict
 * order, or the ring buffer and the LRU drop the wrong row.
 */
function nextOrd(
  db: Db,
  table: "seen" | "tag_meta",
  column: "ord" | "touched",
): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(${column}), 0) AS max FROM ${table}`)
    .get() as { max: number };
  return row.max + 1;
}

export function toggleLike(db: Db, post: Post): LikedPost[] {
  db.transaction(() => {
    const existing = db
      .prepare("SELECT id FROM likes WHERE id = ?")
      .get(post.id);
    if (existing) {
      db.prepare("DELETE FROM likes WHERE id = ?").run(post.id);
      return;
    }
    db.prepare(
      `INSERT INTO likes (id, tags, score, rating, liked_at, post)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      post.id,
      JSON.stringify(tagsOf(post)),
      post.score,
      post.rating,
      Date.now(),
      JSON.stringify(post),
    );
    db.prepare(
      `DELETE FROM likes WHERE id NOT IN
         (SELECT id FROM likes ORDER BY liked_at DESC, id DESC LIMIT ?)`,
    ).run(MAX_LIKES);
  })();
  return readLikes(db);
}

export function dismiss(db: Db, post: Post): DismissedPost[] {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO dismissed (id, tags, dismissed_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(post.id, JSON.stringify(tagsOf(post)), Date.now());
    db.prepare(
      `DELETE FROM dismissed WHERE id NOT IN
         (SELECT id FROM dismissed ORDER BY dismissed_at DESC, id DESC LIMIT ?)`,
    ).run(MAX_DISMISSED);
  })();
  return readDismissed(db);
}

export function undismiss(db: Db, id: number): DismissedPost[] {
  db.prepare("DELETE FROM dismissed WHERE id = ?").run(id);
  return readDismissed(db);
}

export function clearDismissed(db: Db): DismissedPost[] {
  db.prepare("DELETE FROM dismissed").run();
  return readDismissed(db);
}

/**
 * Ids are only ever added, never removed, so this needs no reconciliation
 * with the caller — it returns nothing and the client fires and forgets.
 */
export function recordSeen(db: Db, ids: number[]): void {
  if (ids.length === 0) return;
  db.transaction(() => {
    let ord = nextOrd(db, "seen", "ord");
    const insert = db.prepare(
      "INSERT INTO seen (id, ord) VALUES (?, ?) ON CONFLICT(id) DO NOTHING",
    );
    for (const id of ids) insert.run(id, ord++);
    db.prepare(
      `DELETE FROM seen WHERE id NOT IN
         (SELECT id FROM seen ORDER BY ord DESC LIMIT ?)`,
    ).run(MAX_SEEN);
  })();
}

/** Seeds and blocked tags are replaced wholesale, their order included. */
function replaceTags(
  db: Db,
  table: "seeds" | "blocked_tags",
  tags: string[],
): void {
  db.transaction(() => {
    db.prepare(`DELETE FROM ${table}`).run();
    const insert = db.prepare(`INSERT INTO ${table} (tag, ord) VALUES (?, ?)`);
    tags.forEach((tag, index) => insert.run(tag, index));
  })();
}

export function setSeeds(db: Db, tags: string[]): string[] {
  replaceTags(db, "seeds", [
    ...new Set(tags.map((tag) => tag.trim()).filter(Boolean)),
  ]);
  return readSeeds(db);
}

export function setBlockedTags(db: Db, tags: string[]): string[] {
  replaceTags(db, "blocked_tags", sanitizeBlockedTags(tags));
  return readBlockedTags(db);
}

/**
 * Upsert that also bumps the entry's place in the LRU order, mirroring the
 * delete-then-reinsert the in-memory map used to do.
 */
export function recordTagInfo(db: Db, entries: TagInfo[]): void {
  if (entries.length === 0) return;
  db.transaction(() => {
    let touched = nextOrd(db, "tag_meta", "touched");
    const upsert = db.prepare(
      `INSERT INTO tag_meta (tag, count, category, touched) VALUES (?, ?, ?, ?)
       ON CONFLICT(tag) DO UPDATE SET
         count = excluded.count,
         category = excluded.category,
         touched = excluded.touched`,
    );
    for (const entry of entries) {
      upsert.run(entry.tag, entry.count, entry.type, touched++);
    }
    db.prepare(
      `DELETE FROM tag_meta WHERE tag NOT IN
         (SELECT tag FROM tag_meta ORDER BY touched DESC LIMIT ?)`,
    ).run(MAX_TAGS);
  })();
}

export interface SnapshotImport extends AppSnapshot {
  tagMeta?: TagMetaEntry[];
}

/**
 * Replaces the whole store in one transaction — either all of it lands or
 * none of it does. The one-off backup import is its only caller.
 */
export function replaceSnapshot(db: Db, next: SnapshotImport): void {
  db.transaction(() => {
    for (const table of ["likes", "dismissed", "seen", "seeds", "blocked_tags"]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }

    const insertLike = db.prepare(
      `INSERT INTO likes (id, tags, score, rating, liked_at, post)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`,
    );
    for (const like of next.likes.slice(-MAX_LIKES)) {
      insertLike.run(
        like.id,
        JSON.stringify(like.tags),
        like.score,
        like.rating,
        like.likedAt,
        like.post ? JSON.stringify(like.post) : null,
      );
    }

    const insertDismissed = db.prepare(
      `INSERT INTO dismissed (id, tags, dismissed_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    for (const entry of next.dismissed.slice(-MAX_DISMISSED)) {
      insertDismissed.run(
        entry.id,
        JSON.stringify(entry.tags),
        entry.dismissedAt,
      );
    }

    const insertSeen = db.prepare(
      "INSERT INTO seen (id, ord) VALUES (?, ?) ON CONFLICT(id) DO NOTHING",
    );
    next.seen
      .slice(-MAX_SEEN)
      .forEach((id, index) => insertSeen.run(id, index + 1));

    const insertSeed = db.prepare("INSERT INTO seeds (tag, ord) VALUES (?, ?)");
    [...new Set(next.seeds.map((tag) => tag.trim()).filter(Boolean))].forEach(
      (tag, index) => insertSeed.run(tag, index),
    );

    const insertBlocked = db.prepare(
      "INSERT INTO blocked_tags (tag, ord) VALUES (?, ?)",
    );
    sanitizeBlockedTags(next.blocked)
      .slice(0, MAX_BLOCKED_TAGS)
      .forEach((tag, index) => insertBlocked.run(tag, index));

    if (next.tagMeta?.length) {
      db.prepare("DELETE FROM tag_meta").run();
      const insertMeta = db.prepare(
        `INSERT INTO tag_meta (tag, count, category, touched) VALUES (?, ?, ?, ?)
         ON CONFLICT(tag) DO NOTHING`,
      );
      next.tagMeta
        .slice(-MAX_TAGS)
        .forEach(([tag, count, category], index) =>
          insertMeta.run(tag, count, category, index + 1),
        );
    }
  })();
}
