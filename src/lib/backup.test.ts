// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LikedPost } from "@/lib/prefs";
import type { Post } from "@/lib/types";
import {
  applyBackup,
  downloadJSON,
  fileName,
  mergeLikes,
  parseBackup,
  serializeBackup,
} from "@/lib/backup";
import { readPrefsSnapshot, writePrefsSnapshot } from "@/lib/prefs";

const post: Post = {
  id: 1,
  preview_url: "p",
  sample_url: "s",
  file_url: "f",
  width: 100,
  height: 100,
  sample_width: 100,
  sample_height: 100,
  rating: "explicit",
  score: 10,
  tags: "a b",
  owner: "o",
  change: 0,
  comment_count: 0,
};

function like(id: number, likedAt: number, withPost = false): LikedPost {
  return {
    id,
    tags: ["a"],
    score: 10,
    rating: "explicit",
    likedAt,
    ...(withPost ? { post: { ...post, id } } : {}),
  };
}

function backup(data: Partial<Record<string, unknown>> = {}) {
  return {
    app: "r34-browser",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      likes: [like(1, 1000)],
      seeds: ["miku"],
      hideAi: false,
      mobileColumns: 2,
      ...data,
    },
  };
}

describe("parseBackup", () => {
  it("accepts a v1 backup and defaults the fields it predates", () => {
    const parsed = parseBackup(JSON.stringify(backup()));
    expect(parsed.data.dismissed).toEqual([]);
    expect(parsed.data.seen).toEqual([]);
    expect(parsed.data.blocked).toEqual([]);
    expect(parsed.data.rating).toBe("");
  });

  it("keeps the negative signal of a v2 backup", () => {
    const v2 = {
      ...backup({
        dismissed: [{ id: 7, tags: ["x"], dismissedAt: 5 }],
        seen: [1, 2, 3],
      }),
      version: 2,
    };
    const parsed = parseBackup(JSON.stringify(v2));
    expect(parsed.data.dismissed).toHaveLength(1);
    expect(parsed.data.seen).toEqual([1, 2, 3]);
  });

  it("accepts a well-formed backup", () => {
    const parsed = parseBackup(JSON.stringify(backup()));
    expect(parsed.data.likes).toHaveLength(1);
    expect(parsed.data.seeds).toEqual(["miku"]);
  });

  it("rejects non-JSON", () => {
    expect(() => parseBackup("nope")).toThrow(/valid JSON/);
  });

  it("rejects JSON that isn't a backup", () => {
    expect(() => parseBackup('{"hello":"world"}')).toThrow(/R34 Browser backup/);
  });

  it("rejects a payload written by a newer version", () => {
    const future = { ...backup(), version: 99 };
    expect(() => parseBackup(JSON.stringify(future))).toThrow(/newer version/);
  });

  it("rejects a backup with malformed likes", () => {
    const broken = backup({ likes: [{ id: "not-a-number" }] });
    expect(() => parseBackup(JSON.stringify(broken))).toThrow();
  });
});

describe("mergeLikes", () => {
  it("unions by id", () => {
    const merged = mergeLikes([like(1, 1000)], [like(2, 2000)]);
    expect(merged.map((l) => l.id).sort()).toEqual([1, 2]);
  });

  it("keeps the newer like for the same id", () => {
    const merged = mergeLikes([like(1, 5000)], [like(1, 1000)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].likedAt).toBe(5000);
  });

  it("prefers the entry carrying the full post, even if older", () => {
    const merged = mergeLikes([like(1, 1000, true)], [like(1, 9000)]);
    expect(merged[0].post).toBeDefined();
  });

  it("orders oldest first so the cap drops the oldest likes", () => {
    const merged = mergeLikes([like(1, 3000), like(2, 1000)], [like(3, 2000)]);
    expect(merged.map((l) => l.likedAt)).toEqual([1000, 2000, 3000]);
  });

  it("caps the result at the stored maximum", () => {
    const many = Array.from({ length: 600 }, (_, i) => like(i + 1, i + 1));
    expect(mergeLikes(many, []).length).toBe(500);
    // The newest survive.
    expect(mergeLikes(many, []).at(-1)!.id).toBe(600);
  });
});

describe("serializeBackup", () => {
  beforeEach(() => localStorage.clear());

  it("captures everything the app persists, with a version to check later", () => {
    writePrefsSnapshot({
      likes: [{ id: 1, tags: ["a"], score: 1, rating: "e", likedAt: 5 }],
      dismissed: [{ id: 2, tags: ["b"], dismissedAt: 6 }],
      seen: [3],
      seeds: ["miku"],
      blocked: ["gore"],
      rating: "safe",
      hideAi: true,
      mobileColumns: 1,
    });
    const parsed = parseBackup(serializeBackup());
    expect(parsed.app).toBe("r34-browser");
    expect(parsed.version).toBe(3);
    expect(parsed.data.likes).toHaveLength(1);
    expect(parsed.data.dismissed).toHaveLength(1);
    expect(parsed.data.seen).toEqual([3]);
    expect(parsed.data.seeds).toEqual(["miku"]);
    expect(parsed.data.blocked).toEqual(["gore"]);
    expect(parsed.data.rating).toBe("safe");
    expect(parsed.data.hideAi).toBe(true);
    expect(Date.parse(parsed.exportedAt)).not.toBeNaN();
  });
});

describe("fileName", () => {
  it("dates the file so backups sort and don't overwrite each other", () => {
    expect(fileName(new Date("2026-08-31T12:00:00Z"))).toBe(
      "r34-browser-backup-2026-08-31.json",
    );
  });
});

describe("downloadJSON", () => {
  it("hands the browser a named JSON file and releases the object URL", () => {
    const createObjectURL = vi.fn(() => "blob:x");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    downloadJSON('{"a":1}', "backup.json");

    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:x");
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("applyBackup", () => {
  beforeEach(() => localStorage.clear());

  const incoming = () =>
    parseBackup(
      JSON.stringify({
        app: "r34-browser",
        version: 2,
        exportedAt: new Date().toISOString(),
        data: {
          likes: [like(2, 2000)],
          seeds: ["from-file"],
          hideAi: true,
          mobileColumns: 1,
          dismissed: [{ id: 20, tags: ["x"], dismissedAt: 1 }],
          seen: [200],
          blocked: ["from_file"],
          rating: "safe",
        },
      }),
    );

  function seedCurrent() {
    writePrefsSnapshot({
      likes: [like(1, 1000)],
      dismissed: [{ id: 10, tags: ["y"], dismissedAt: 1 }],
      seen: [100],
      seeds: ["current"],
      blocked: ["blocked_here"],
      rating: "",
      hideAi: false,
      mobileColumns: 2,
    });
  }

  it("merges both sides without losing anything", () => {
    seedCurrent();
    applyBackup(incoming(), "merge");
    const snapshot = readPrefsSnapshot();
    expect(snapshot.likes.map((l) => l.id).sort()).toEqual([1, 2]);
    expect(snapshot.dismissed.map((d) => d.id).sort()).toEqual([10, 20]);
    expect(snapshot.seen.sort()).toEqual([100, 200]);
    expect(snapshot.seeds.sort()).toEqual(["current", "from-file"]);
    expect(snapshot.blocked.sort()).toEqual(["blocked_here", "from_file"]);
    expect(snapshot.rating).toBe("safe");
  });

  it("replaces everything with the file's contents", () => {
    seedCurrent();
    applyBackup(incoming(), "replace");
    const snapshot = readPrefsSnapshot();
    expect(snapshot.likes.map((l) => l.id)).toEqual([2]);
    expect(snapshot.dismissed.map((d) => d.id)).toEqual([20]);
    expect(snapshot.seen).toEqual([200]);
    expect(snapshot.seeds).toEqual(["from-file"]);
    expect(snapshot.blocked).toEqual(["from_file"]);
    expect(snapshot.mobileColumns).toBe(1);
  });

  it("restores onto a fresh install", () => {
    applyBackup(incoming(), "merge");
    expect(readPrefsSnapshot().likes).toHaveLength(1);
  });

  it("reports the resulting state so the UI can say what happened", () => {
    seedCurrent();
    expect(applyBackup(incoming(), "merge").likes).toHaveLength(2);
  });
});
