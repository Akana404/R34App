// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureTagMeta,
  fetchTagMetaForPost,
  groupTagsByCategory,
  readTagMeta,
  recordTagInfo,
} from "@/lib/tagmeta";
import type { Post, TagCategory, TagMetaMap } from "@/lib/types";

function meta(entries: [string, TagCategory][]): TagMetaMap {
  return new Map(entries.map(([tag, category]) => [tag, { count: 1, category }]));
}

function post(id: number, tags: string): Post {
  return {
    id,
    preview_url: "p",
    sample_url: "s",
    file_url: "f",
    width: 1,
    height: 1,
    sample_width: 1,
    sample_height: 1,
    rating: "explicit",
    score: 0,
    tags,
    owner: "o",
    change: 0,
    comment_count: 0,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recordTagInfo", () => {
  it("stores count and category per tag", () => {
    recordTagInfo([
      { tag: "miku", count: 40060, type: "character" },
      { tag: "3d", count: 1_400_000, type: "metadata" },
    ]);
    const meta = readTagMeta();
    expect(meta.get("miku")).toEqual({ count: 40060, category: "character" });
    expect(meta.get("3d")?.category).toBe("metadata");
  });

  it("merges into what is already stored and refreshes counts", () => {
    recordTagInfo([{ tag: "a", count: 1, type: "tag" }]);
    recordTagInfo([{ tag: "b", count: 2, type: "tag" }]);
    recordTagInfo([{ tag: "a", count: 99, type: "artist" }]);
    const meta = readTagMeta();
    expect(meta.size).toBe(2);
    expect(meta.get("a")).toEqual({ count: 99, category: "artist" });
  });

  it("caps the store, dropping the tags touched longest ago", () => {
    recordTagInfo(
      Array.from({ length: 8100 }, (_, i) => ({
        tag: `t${i}`,
        count: i,
        type: "tag",
      })),
    );
    const meta = readTagMeta();
    expect(meta.size).toBe(8000);
    expect(meta.has("t0")).toBe(false);
    expect(meta.has("t8099")).toBe(true);
  });

  it("keeps a tag that was written again from being trimmed as stale", () => {
    recordTagInfo(
      Array.from({ length: 8000 }, (_, i) => ({
        tag: `t${i}`,
        count: i,
        type: "tag",
      })),
    );
    recordTagInfo([{ tag: "t0", count: 1, type: "tag" }]);
    recordTagInfo([{ tag: "fresh", count: 1, type: "tag" }]);
    const meta = readTagMeta();
    expect(meta.has("t0")).toBe(true);
    expect(meta.has("t1")).toBe(false);
  });

  it("notifies subscribers in this tab, which the storage event alone misses", () => {
    const listener = vi.fn();
    window.addEventListener("storage", listener);
    recordTagInfo([{ tag: "a", count: 1, type: "tag" }]);
    expect(listener).toHaveBeenCalled();
    window.removeEventListener("storage", listener);
  });

  it("keeps integer-like tags refreshable like any other", () => {
    // Object keys enumerate "2023" before "a" whenever they were inserted,
    // which made year tags the first eviction victims; the entry-array
    // store keeps true recency order.
    recordTagInfo([{ tag: "2023", count: 1, type: "metadata" }]);
    recordTagInfo([{ tag: "a", count: 1, type: "tag" }]);
    recordTagInfo([{ tag: "2023", count: 2, type: "metadata" }]);
    const stored = JSON.parse(localStorage.getItem("tagMeta")!) as [string][];
    expect(stored.map((entry) => entry[0])).toEqual(["a", "2023"]);
  });

  it("still reads a store written in the legacy object shape", () => {
    localStorage.setItem("tagMeta", JSON.stringify({ miku: [5, "character"] }));
    expect(readTagMeta().get("miku")).toEqual({
      count: 5,
      category: "character",
    });
  });

  it("recovers from a corrupted store", () => {
    localStorage.setItem("tagMeta", "{not json");
    expect(readTagMeta().size).toBe(0);
    recordTagInfo([{ tag: "a", count: 1, type: "tag" }]);
    expect(readTagMeta().get("a")?.count).toBe(1);
  });

  it("returns a stable snapshot so useSyncExternalStore doesn't loop", () => {
    recordTagInfo([{ tag: "a", count: 1, type: "tag" }]);
    expect(readTagMeta()).toBe(readTagMeta());
    recordTagInfo([{ tag: "b", count: 2, type: "tag" }]);
    expect(readTagMeta().size).toBe(2);
  });
});

describe("fetchTagMetaForPost", () => {
  function mockFetch(body: unknown, ok = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<unknown> => ({ ok, json: async () => body })),
    );
  }

  const lastUrl = () =>
    new URL(
      String(vi.mocked(globalThis.fetch).mock.calls.at(-1)![0]),
      "http://localhost",
    );

  it("asks for exactly one post by id, with tag_info", async () => {
    mockFetch([{ tag_info: [{ tag: "miku", count: 5, type: "character" }] }]);
    await expect(fetchTagMetaForPost(42)).resolves.toBe(true);
    const url = lastUrl();
    expect(url.pathname).toBe("/api/posts");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      tags: "id:42",
      limit: "1",
      tagInfo: "1",
    });
    expect(readTagMeta().get("miku")?.count).toBe(5);
  });

  it("throws on a failed request so callers can tell it was transient", async () => {
    mockFetch([], false);
    await expect(fetchTagMetaForPost(1)).rejects.toThrow();
    expect(readTagMeta().size).toBe(0);
  });

  it("reports failure when the post carries no tag_info", async () => {
    mockFetch([{ id: 1 }]);
    await expect(fetchTagMetaForPost(1)).resolves.toBe(false);
  });

  it("reports failure when the post no longer exists", async () => {
    mockFetch([]);
    await expect(fetchTagMetaForPost(1)).resolves.toBe(false);
  });
});

describe("groupTagsByCategory", () => {
  it("puts who made it and what it is before the details", () => {
    const groups = groupTagsByCategory(
      ["sfx", "an_artist", "3d", "a_series", "a_character"],
      meta([
        ["an_artist", "artist"],
        ["a_character", "character"],
        ["a_series", "copyright"],
        ["3d", "metadata"],
        ["sfx", "tag"],
      ]),
    );
    expect(groups.map((g) => g.category)).toEqual([
      "artist",
      "character",
      "copyright",
      "tag",
      "metadata",
    ]);
  });

  it("keeps tags with no metadata visible, among the general ones", () => {
    const groups = groupTagsByCategory(["known", "unknown"], meta([["known", "tag"]]));
    expect(groups).toEqual([{ category: "tag", tags: ["known", "unknown"] }]);
  });

  it("files an unfamiliar category with the general tags", () => {
    const groups = groupTagsByCategory(
      ["odd"],
      new Map([["odd", { count: 1, category: "brand_new" as TagCategory }]]),
    );
    expect(groups).toEqual([{ category: "tag", tags: ["odd"] }]);
  });

  it("omits categories the post has no tags for", () => {
    const groups = groupTagsByCategory(["a"], meta([["a", "artist"]]));
    expect(groups).toHaveLength(1);
  });
});

describe("ensureTagMeta", () => {
  function mockFetch(info: { tag: string; count: number; type: string }[]) {
    const fetchMock = vi.fn(
      async (): Promise<unknown> => ({
        ok: true,
        json: async () => [{ tag_info: info }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("looks a post up and stores what it learns", async () => {
    mockFetch([{ tag: "a", count: 5, type: "artist" }]);
    await ensureTagMeta(post(1, "a b c"));
    expect(readTagMeta().get("a")?.category).toBe("artist");
  });

  it("asks only once per post, however often it is opened", async () => {
    const fetchMock = mockFetch([{ tag: "a", count: 5, type: "tag" }]);
    await ensureTagMeta(post(2, "a b c"));
    await ensureTagMeta(post(2, "a b c"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips the request when the tags are already described", async () => {
    recordTagInfo([
      { tag: "x", count: 1, type: "tag" },
      { tag: "y", count: 1, type: "tag" },
    ]);
    const fetchMock = mockFetch([]);
    await ensureTagMeta(post(3, "x y"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays quiet when the lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(ensureTagMeta(post(4, "a b"))).resolves.toBeUndefined();
  });

  it("retries a post whose lookup failed transiently", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await ensureTagMeta(post(6, "q r"));
    const fetchMock = mockFetch([{ tag: "q", count: 1, type: "tag" }]);
    await ensureTagMeta(post(6, "q r"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a post without tags", async () => {
    const fetchMock = mockFetch([]);
    await ensureTagMeta(post(5, ""));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
