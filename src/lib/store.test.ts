import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createSchema, type Db } from "@/lib/db";
import {
  MAX_BLOCKED_TAGS,
  MAX_DISMISSED,
  MAX_LIKES,
  MAX_SEEN,
  MAX_TAGS,
} from "@/lib/state";
import {
  clearDismissed,
  dismiss,
  readBlockedTags,
  readDismissed,
  readLikePosts,
  readLikes,
  readSeeds,
  readSeen,
  readSnapshot,
  readTagMeta,
  recordSeen,
  recordTagInfo,
  replaceSnapshot,
  setBlockedTags,
  setSeeds,
  toggleLike,
  undismiss,
} from "@/lib/store";
import type { Post } from "@/lib/types";

function post(id: number, tags = "artist_a character_b"): Post {
  return {
    id,
    preview_url: `https://example.test/${id}-preview.jpg`,
    sample_url: `https://example.test/${id}-sample.jpg`,
    file_url: `https://example.test/${id}.jpg`,
    width: 1000,
    height: 1500,
    sample_width: 800,
    sample_height: 1200,
    rating: "explicit",
    score: id,
    tags,
    owner: "someone",
    change: 0,
    comment_count: 0,
  };
}

let db: Db;

beforeEach(() => {
  db = createSchema(new Database(":memory:"));
});

describe("likes", () => {
  it("toggles a post in and back out", () => {
    expect(toggleLike(db, post(1))).toHaveLength(1);
    expect(readLikes(db)[0]).toMatchObject({
      id: 1,
      tags: ["artist_a", "character_b"],
      score: 1,
      rating: "explicit",
    });

    expect(toggleLike(db, post(1))).toEqual([]);
  });

  it("keeps the full post alongside the like", () => {
    toggleLike(db, post(7));
    expect(readLikePosts(db)).toEqual([post(7)]);
  });

  it("drops an unreadable post blob without losing the like", () => {
    toggleLike(db, post(7));
    db.prepare("UPDATE likes SET post = ? WHERE id = ?").run("{ nope", 7);

    expect(readLikePosts(db)).toEqual([]);
    expect(readLikes(db)).toHaveLength(1);
  });

  it("evicts the oldest like past the cap", () => {
    for (let id = 1; id <= MAX_LIKES + 1; id++) toggleLike(db, post(id));

    const likes = readLikes(db);
    expect(likes).toHaveLength(MAX_LIKES);
    expect(likes.some((like) => like.id === 1)).toBe(false);
    expect(likes.some((like) => like.id === MAX_LIKES + 1)).toBe(true);
  });
});

describe("dismissed", () => {
  it("records a dismissal once", () => {
    dismiss(db, post(1));
    const twice = dismiss(db, post(1));

    expect(twice).toHaveLength(1);
    expect(twice[0]).toMatchObject({ id: 1, tags: ["artist_a", "character_b"] });
  });

  it("undismisses and clears", () => {
    dismiss(db, post(1));
    dismiss(db, post(2));

    expect(undismiss(db, 1).map((entry) => entry.id)).toEqual([2]);
    expect(clearDismissed(db)).toEqual([]);
  });

  it("evicts the oldest dismissal past the cap", () => {
    for (let id = 1; id <= MAX_DISMISSED + 1; id++) dismiss(db, post(id));

    const dismissed = readDismissed(db);
    expect(dismissed).toHaveLength(MAX_DISMISSED);
    expect(dismissed.some((entry) => entry.id === 1)).toBe(false);
  });
});

describe("seen", () => {
  it("records ids once, in order", () => {
    recordSeen(db, [3, 1]);
    recordSeen(db, [1, 2]);

    expect(readSeen(db)).toEqual([3, 1, 2]);
  });

  it("keeps only the most recent ids", () => {
    const ids = Array.from({ length: MAX_SEEN + 1 }, (_, i) => i + 1);
    recordSeen(db, ids);

    const seen = readSeen(db);
    expect(seen).toHaveLength(MAX_SEEN);
    expect(seen[0]).toBe(2);
    expect(seen.at(-1)).toBe(MAX_SEEN + 1);
  });
});

describe("seeds and blocked tags", () => {
  it("replaces seeds wholesale and keeps their order", () => {
    setSeeds(db, ["b", "a"]);
    expect(readSeeds(db)).toEqual(["b", "a"]);

    expect(setSeeds(db, ["c"])).toEqual(["c"]);
  });

  it("strips metatags, leading dashes and duplicates from blocked tags", () => {
    const blocked = setBlockedTags(db, [
      " -gore ",
      "gore",
      "rating:safe",
      "",
      "scat",
    ]);

    expect(blocked).toEqual(["gore", "scat"]);
  });

  it("caps the blocked list", () => {
    const many = Array.from({ length: MAX_BLOCKED_TAGS + 5 }, (_, i) => `t${i}`);
    expect(setBlockedTags(db, many)).toHaveLength(MAX_BLOCKED_TAGS);
    expect(readBlockedTags(db)).toHaveLength(MAX_BLOCKED_TAGS);
  });
});

describe("tag metadata", () => {
  it("upserts a tag's count and category", () => {
    recordTagInfo(db, [{ tag: "a", count: 1, type: "tag" }]);
    recordTagInfo(db, [{ tag: "a", count: 99, type: "artist" }]);

    expect(readTagMeta(db)).toEqual([["a", 99, "artist"]]);
  });

  it("evicts the least recently seen tag past the cap", () => {
    recordTagInfo(
      db,
      Array.from({ length: MAX_TAGS }, (_, i) => ({
        tag: `t${i}`,
        count: 1,
        type: "tag",
      })),
    );
    // Touching the oldest entry again has to move it out of harm's way.
    recordTagInfo(db, [{ tag: "t0", count: 2, type: "tag" }]);
    recordTagInfo(db, [{ tag: "fresh", count: 1, type: "tag" }]);

    const tags = readTagMeta(db).map(([tag]) => tag);
    expect(tags).toHaveLength(MAX_TAGS);
    expect(tags).toContain("t0");
    expect(tags).toContain("fresh");
    expect(tags).not.toContain("t1");
  });
});

describe("readSnapshot", () => {
  it("reports every slice the app needs up front", () => {
    toggleLike(db, post(1));
    dismiss(db, post(2));
    recordSeen(db, [3]);
    setSeeds(db, ["seed"]);
    setBlockedTags(db, ["gore"]);

    expect(readSnapshot(db)).toMatchObject({
      likes: [{ id: 1 }],
      dismissed: [{ id: 2 }],
      seen: [3],
      seeds: ["seed"],
      blocked: ["gore"],
    });
  });
});

describe("replaceSnapshot", () => {
  it("replaces everything that was there before", () => {
    toggleLike(db, post(1));
    setSeeds(db, ["old"]);

    replaceSnapshot(db, {
      likes: [
        { id: 9, tags: ["x"], score: 5, rating: "safe", likedAt: 10, post: post(9) },
      ],
      dismissed: [{ id: 8, tags: ["y"], dismissedAt: 11 }],
      seen: [7],
      seeds: ["new"],
      blocked: ["-gore", "rating:safe"],
      tagMeta: [["x", 3, "artist"]],
    });

    expect(readSnapshot(db)).toMatchObject({
      likes: [{ id: 9, tags: ["x"], likedAt: 10 }],
      dismissed: [{ id: 8 }],
      seen: [7],
      seeds: ["new"],
      blocked: ["gore"],
    });
    expect(readLikePosts(db)).toEqual([post(9)]);
    expect(readTagMeta(db)).toEqual([["x", 3, "artist"]]);
  });

  it("applies the caps to an oversized import", () => {
    replaceSnapshot(db, {
      likes: Array.from({ length: MAX_LIKES + 3 }, (_, i) => ({
        id: i + 1,
        tags: [],
        score: 0,
        rating: "safe",
        likedAt: i,
      })),
      dismissed: [],
      seen: Array.from({ length: MAX_SEEN + 3 }, (_, i) => i + 1),
      seeds: [],
      blocked: [],
    });

    expect(readLikes(db)).toHaveLength(MAX_LIKES);
    expect(readSeen(db)).toHaveLength(MAX_SEEN);
  });
});
