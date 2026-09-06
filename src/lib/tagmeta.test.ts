// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTagMeta as readStoredTagMeta } from "@/lib/store";
import {
  ensureTagMeta,
  fetchTagMetaForPost,
  groupTagsByCategory,
  loadTagMeta,
  readTagMeta,
  recordTagInfo,
  useTagMeta,
} from "@/lib/tagmeta";
import type { Post, TagCategory, TagMetaMap } from "@/lib/types";
import { installStore, type StoreHarness } from "@/test/store";

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

let harness: StoreHarness;

/** Answers the post lookup `fetchTagMetaForPost` makes. */
function servePost(info: { tag: string; count: number; type: string }[]) {
  harness.route("/api/posts", () => [{ tag_info: info }]);
  return harness.fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  harness = installStore();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("recordTagInfo", () => {
  it("stores count and category per tag", async () => {
    recordTagInfo([
      { tag: "miku", count: 40060, type: "character" },
      { tag: "3d", count: 1_400_000, type: "metadata" },
    ]);

    expect(readTagMeta().get("miku")).toEqual({
      count: 40060,
      category: "character",
    });
    expect(readTagMeta().get("3d")?.category).toBe("metadata");

    await harness.settle();
    expect(readStoredTagMeta(harness.db)).toEqual([
      ["miku", 40060, "character"],
      ["3d", 1400000, "metadata"],
    ]);
  });

  it("merges into what is already known and refreshes counts", () => {
    recordTagInfo([{ tag: "a", count: 1, type: "tag" }]);
    recordTagInfo([{ tag: "b", count: 2, type: "tag" }]);
    recordTagInfo([{ tag: "a", count: 99, type: "artist" }]);

    expect(readTagMeta().size).toBe(2);
    expect(readTagMeta().get("a")).toEqual({ count: 99, category: "artist" });
  });

  it("shows what it learned without waiting for the write to land", () => {
    // TagMetaSync reads its own writes to pick the next post to look up.
    recordTagInfo([{ tag: "a", count: 1, type: "tag" }]);
    expect(readTagMeta().has("a")).toBe(true);
    expect(harness.fetchMock).toHaveBeenCalled();
  });

  it("re-renders the components reading it", () => {
    const { result } = renderHook(() => useTagMeta());
    expect(result.current.size).toBe(0);

    act(() => recordTagInfo([{ tag: "a", count: 1, type: "tag" }]));

    expect(result.current.get("a")?.count).toBe(1);
  });

  it("returns a stable snapshot so useSyncExternalStore doesn't loop", () => {
    recordTagInfo([{ tag: "a", count: 1, type: "tag" }]);
    expect(readTagMeta()).toBe(readTagMeta());

    recordTagInfo([{ tag: "b", count: 2, type: "tag" }]);
    expect(readTagMeta().size).toBe(2);
  });
});

describe("loadTagMeta", () => {
  it("reads the stored cache in once", async () => {
    harness = installStore({ tagMeta: [["miku", 5, "character"]] });

    await loadTagMeta();
    expect(readTagMeta().get("miku")).toEqual({
      count: 5,
      category: "character",
    });

    const calls = harness.fetchMock.mock.calls.length;
    await loadTagMeta();
    expect(harness.fetchMock.mock.calls).toHaveLength(calls);
  });

  it("keeps what was learned while the read was in flight", async () => {
    harness = installStore({ tagMeta: [["miku", 5, "character"]] });

    const inFlight = loadTagMeta();
    recordTagInfo([{ tag: "miku", count: 6, type: "artist" }]);
    await inFlight;

    expect(readTagMeta().get("miku")).toEqual({ count: 6, category: "artist" });
  });

  it("leaves the cache empty when it can't be read", async () => {
    harness.fetchMock.mockRejectedValueOnce(new Error("offline"));

    await loadTagMeta();
    expect(readTagMeta().size).toBe(0);
  });
});

describe("fetchTagMetaForPost", () => {
  // The write-through to /api/state follows every lookup, so pick the
  // lookup itself rather than whatever was sent last.
  const lastPostUrl = () =>
    new URL(
      String(
        harness.fetchMock.mock.calls
          .map((call) => String(call[0]))
          .filter((url) => url.startsWith("/api/posts"))
          .at(-1),
      ),
      "http://localhost",
    );

  it("asks for exactly one post by id, with tag_info", async () => {
    servePost([{ tag: "miku", count: 5, type: "character" }]);

    await expect(fetchTagMetaForPost(42)).resolves.toBe(true);

    const url = lastPostUrl();
    expect(url.pathname).toBe("/api/posts");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      tags: "id:42",
      limit: "1",
      tagInfo: "1",
    });
    expect(readTagMeta().get("miku")?.count).toBe(5);
  });

  it("throws on a failed request so callers can tell it was transient", async () => {
    harness.route("/api/posts", () => {
      throw new Error("rate limited");
    });

    await expect(fetchTagMetaForPost(1)).rejects.toThrow();
    expect(readTagMeta().size).toBe(0);
  });

  it("reports failure when the post carries no tag_info", async () => {
    harness.route("/api/posts", () => [{ id: 1 }]);
    await expect(fetchTagMetaForPost(1)).resolves.toBe(false);
  });

  it("reports failure when the post no longer exists", async () => {
    harness.route("/api/posts", () => []);
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
    const groups = groupTagsByCategory(
      ["known", "unknown"],
      meta([["known", "tag"]]),
    );
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
  function postLookups() {
    return harness.fetchMock.mock.calls.filter((call) =>
      String(call[0]).startsWith("/api/posts"),
    ).length;
  }

  it("looks a post up and stores what it learns", async () => {
    servePost([{ tag: "a", count: 5, type: "artist" }]);

    await ensureTagMeta(post(1, "a b c"));

    expect(readTagMeta().get("a")?.category).toBe("artist");
  });

  it("asks only once per post, however often it is opened", async () => {
    servePost([{ tag: "a", count: 5, type: "tag" }]);

    await ensureTagMeta(post(2, "a b c"));
    await ensureTagMeta(post(2, "a b c"));

    expect(postLookups()).toBe(1);
  });

  it("skips the request when the tags are already described", async () => {
    recordTagInfo([
      { tag: "x", count: 1, type: "tag" },
      { tag: "y", count: 1, type: "tag" },
    ]);
    servePost([]);

    await ensureTagMeta(post(3, "x y"));

    expect(postLookups()).toBe(0);
  });

  it("stays quiet when the lookup fails", async () => {
    harness.route("/api/posts", () => {
      throw new Error("offline");
    });

    await expect(ensureTagMeta(post(4, "a b"))).resolves.toBeUndefined();
  });

  it("retries a post whose lookup failed transiently", async () => {
    harness.route("/api/posts", () => {
      throw new Error("offline");
    });
    await ensureTagMeta(post(6, "q r"));

    servePost([{ tag: "q", count: 1, type: "tag" }]);
    await ensureTagMeta(post(6, "q r"));

    expect(postLookups()).toBe(2);
  });

  it("does nothing for a post without tags", async () => {
    servePost([]);

    await ensureTagMeta(post(5, ""));

    expect(postLookups()).toBe(0);
  });
});
