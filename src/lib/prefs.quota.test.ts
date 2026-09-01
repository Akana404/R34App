// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/types";

// The storage-failure flag is sticky module state, so every test loads a
// fresh copy of the store.
async function loadPrefs() {
  vi.resetModules();
  return await import("@/lib/prefs");
}

async function loadTagMeta() {
  vi.resetModules();
  return await import("@/lib/tagmeta");
}

function post(id: number, tags = "a b"): Post {
  return {
    id,
    preview_url: "p",
    sample_url: "s",
    file_url: "f",
    width: 100,
    height: 100,
    sample_width: 100,
    sample_height: 100,
    rating: "explicit",
    score: 5,
    tags,
    owner: "o",
    change: 0,
    comment_count: 0,
  };
}

/** Makes `localStorage.setItem` throw for the given keys (or every key). */
function failWritesFor(keys: string[] | "all") {
  const real = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (keys === "all" || keys.includes(key))
      throw new DOMException("quota", "QuotaExceededError");
    real.call(this, key, value);
  });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("storage writes when the store is full", () => {
  it("a like on a full store does not throw out of the click handler", async () => {
    const { useLikes } = await loadPrefs();
    failWritesFor("all");
    const { result } = renderHook(() => useLikes());
    expect(() => act(() => result.current.toggleLike(post(1)))).not.toThrow();
    expect(localStorage.getItem("forYou:likes")).toBeNull();
  });

  it("recordSeen on a full store does not throw out of the effect", async () => {
    const { recordSeen } = await loadPrefs();
    failWritesFor("all");
    expect(() => recordSeen([1, 2, 3])).not.toThrow();
  });

  it("raises the user-facing warning after the first failed write", async () => {
    const { useLikes, useStorageWarning } = await loadPrefs();
    const warning = renderHook(() => useStorageWarning());
    expect(warning.result.current).toBe(false);
    failWritesFor("all");
    const likes = renderHook(() => useLikes());
    act(() => likes.result.current.toggleLike(post(1)));
    expect(warning.result.current).toBe(true);
  });

  it("stays quiet while writes succeed", async () => {
    const { useLikes, useStorageWarning } = await loadPrefs();
    const warning = renderHook(() => useStorageWarning());
    const likes = renderHook(() => useLikes());
    act(() => likes.result.current.toggleLike(post(1)));
    expect(warning.result.current).toBe(false);
  });
});

describe("writePrefsSnapshot on a full store", () => {
  it("rolls back the keys already written and reports the failure", async () => {
    const prefs = await loadPrefs();
    prefs.writePrefsSnapshot({
      likes: [{ id: 1, tags: ["a"], score: 1, rating: "explicit", likedAt: 1 }],
      dismissed: [],
      seen: [7],
      seeds: ["miku"],
      blocked: [],
      rating: "",
      hideAi: false,
      mobileColumns: 2,
    });
    const before = prefs.readPrefsSnapshot();

    // Likes/dismissed/seen/seeds land first, then the blocklist write fails.
    failWritesFor(["blockedTags"]);
    const ok = prefs.writePrefsSnapshot({
      likes: [{ id: 2, tags: ["b"], score: 1, rating: "explicit", likedAt: 2 }],
      dismissed: [],
      seen: [8],
      seeds: ["vocaloid"],
      blocked: ["gore"],
      rating: "safe",
      hideAi: true,
      mobileColumns: 1,
    });
    expect(ok).toBe(false);
    vi.restoreAllMocks();
    expect(prefs.readPrefsSnapshot()).toEqual(before);
  });

  it("returns true when every key lands", async () => {
    const prefs = await loadPrefs();
    expect(prefs.writePrefsSnapshot(prefs.readPrefsSnapshot())).toBe(true);
  });
});

describe("recordTagInfo on a full store", () => {
  it("evicts the older half of the cache and retries the write", async () => {
    const tagmeta = await loadTagMeta();
    tagmeta.recordTagInfo(
      Array.from({ length: 10 }, (_, i) => ({
        tag: `old${i}`,
        count: 1,
        type: "tag",
      })),
    );

    const real = Storage.prototype.setItem;
    let failed = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === "tagMeta" && !failed) {
        failed = true;
        throw new DOMException("quota", "QuotaExceededError");
      }
      real.call(this, key, value);
    });

    tagmeta.recordTagInfo([{ tag: "fresh", count: 5, type: "artist" }]);
    const stored = JSON.parse(
      localStorage.getItem("tagMeta") ?? "[]",
    ) as [string, number, string][];
    expect(stored.find(([tag]) => tag === "fresh")).toEqual([
      "fresh",
      5,
      "artist",
    ]);
    expect(stored.length).toBeLessThan(11);
  });

  it("gives up quietly when even the trimmed write fails", async () => {
    const tagmeta = await loadTagMeta();
    failWritesFor(["tagMeta"]);
    expect(() =>
      tagmeta.recordTagInfo([{ tag: "t", count: 1, type: "tag" }]),
    ).not.toThrow();
  });
});
