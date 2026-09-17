import { describe, expect, it } from "vitest";
import {
  BACKUP_APP,
  BACKUP_VERSION,
  buildExport,
  hasBackupContent,
  normalizeBackup,
} from "@/lib/backup";
import type { Post } from "@/lib/types";

function post(id: number): Post {
  return {
    id,
    preview_url: "p",
    sample_url: "s",
    file_url: "f",
    width: 1,
    height: 1,
    sample_width: 1,
    sample_height: 1,
    rating: "safe",
    score: 0,
    tags: "a b",
    owner: "o",
    change: 0,
    comment_count: 0,
  };
}

const like = (id: number) => ({
  id,
  tags: ["a"],
  score: 3,
  rating: "safe",
  likedAt: 5,
  post: post(id),
});

describe("buildExport", () => {
  it("wraps the content in a versioned envelope without the caches", () => {
    const content = { likes: [like(1)], dismissed: [], seeds: ["s"], blocked: ["b"] };
    // Extra fields a caller hands over must not leak into the file.
    const envelope = buildExport(
      { ...content, seen: [1, 2] } as typeof content,
      new Date("2026-09-17T10:00:00Z"),
    );

    expect(envelope).toEqual({
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: "2026-09-17T10:00:00.000Z",
      data: content,
    });
  });
});

describe("normalizeBackup", () => {
  it("reads back what buildExport wrote", () => {
    const content = {
      likes: [like(1)],
      dismissed: [{ id: 2, tags: ["x"], dismissedAt: 6 }],
      seeds: ["s"],
      blocked: ["b"],
    };
    const result = normalizeBackup(
      JSON.parse(JSON.stringify(buildExport(content))),
    );

    expect(result?.backup).toMatchObject(content);
    expect(hasBackupContent(result!.present)).toBe(true);
  });

  it("accepts a flat dump of the old localStorage keys, values as JSON strings", () => {
    const result = normalizeBackup({
      "forYou:likes": JSON.stringify([{ id: 1, tags: "a b", likedAt: 1 }]),
      "forYou:seen": "[4,5]",
      blockedTags: '["gore"]',
      tagMeta: JSON.stringify({ a: [10, "artist"] }),
    });

    expect(result?.backup).toMatchObject({
      likes: [{ id: 1, tags: ["a", "b"], score: 0, rating: "" }],
      seen: [4, 5],
      blocked: ["gore"],
      tagMeta: [["a", 10, "artist"]],
    });
  });

  it("drops broken entries one at a time, and an invalid post without its like", () => {
    const result = normalizeBackup({
      data: {
        likes: [{ id: 1, post: post(1) }, { id: "nope" }, null, { id: 3, post: { id: 3 } }],
        dismissed: [{ tags: [] }, { id: 4 }],
        seeds: ["ok", 5],
      },
    });

    expect(result?.backup.likes.map((entry) => entry.id)).toEqual([1, 3]);
    expect(result?.backup.likes[0].post).toEqual(post(1));
    expect(result?.backup.likes[1].post).toBeUndefined();
    expect(result?.backup.dismissed.map((entry) => entry.id)).toEqual([4]);
    expect(result?.backup.seeds).toEqual(["ok"]);
  });

  it("returns null for input that names no field at all", () => {
    expect(normalizeBackup({ hello: "world" })).toBeNull();
    expect(normalizeBackup([1, 2])).toBeNull();
    expect(normalizeBackup("text")).toBeNull();
  });

  it("tells an empty backup apart from a file carrying only caches", () => {
    const empty = normalizeBackup(
      buildExport({ likes: [], dismissed: [], seeds: [], blocked: [] }),
    );
    expect(empty && hasBackupContent(empty.present)).toBe(true);

    const cachesOnly = normalizeBackup({ "forYou:seen": [1] });
    expect(cachesOnly && hasBackupContent(cachesOnly.present)).toBe(false);
  });
});
