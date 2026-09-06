// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/types";
import {
  MAX_BLOCKED_TAGS,
  MAX_DISMISSED,
  MAX_LIKES,
  MAX_SEEN,
  contentFilterTags,
  readSeen,
  recordSeen,
  useBlockedTags,
  useDismissed,
  useHideAi,
  useLikes,
  useMobileColumns,
  useRating,
  useSeedTags,
  useStorageWarning,
} from "@/lib/prefs";
import {
  readBlockedTags,
  readDismissed,
  readLikePosts,
  readLikes,
  readSeeds,
  readSeen as readStoredSeen,
} from "@/lib/store";
import { installStore, type Seed, type StoreHarness } from "@/test/store";

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

let harness: StoreHarness;

function start(seed: Seed = {}) {
  harness = installStore(seed);
  return harness;
}

beforeEach(() => {
  localStorage.clear();
  start();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useLikes", () => {
  it("keeps the whole post so the Liked page can render it", async () => {
    const { result } = renderHook(() => useLikes());
    act(() => result.current.toggleLike(post(1, "miku 1girls")));

    expect(result.current.isLiked(1)).toBe(true);
    expect(result.current.likes[0]).toMatchObject({
      id: 1,
      tags: ["miku", "1girls"],
    });

    await harness.settle();
    expect(readLikePosts(harness.db)[0].file_url).toBe("f");
  });

  it("toggles a like off again", async () => {
    const { result } = renderHook(() => useLikes());
    act(() => result.current.toggleLike(post(1)));
    await harness.settle();
    act(() => result.current.toggleLike(post(1)));
    await harness.settle();

    expect(result.current.likes).toEqual([]);
    expect(readLikes(harness.db)).toEqual([]);
  });

  it("does not lose a like when two toggles land in the same tick", async () => {
    const { result } = renderHook(() => useLikes());
    act(() => {
      result.current.toggleLike(post(1));
      result.current.toggleLike(post(2));
    });
    await harness.settle();

    expect(result.current.likes.map((like) => like.id)).toEqual([1, 2]);
  });

  it("shows the like before the server has answered", () => {
    const { result } = renderHook(() => useLikes());
    act(() => result.current.toggleLike(post(1)));

    // No settle(): the paint must not wait on the round trip.
    expect(result.current.isLiked(1)).toBe(true);
  });

  it("caps the list, dropping the oldest likes", async () => {
    start({
      likes: Array.from({ length: MAX_LIKES }, (_, i) => ({
        id: i + 1,
        tags: ["a"],
        score: 1,
        rating: "explicit",
        likedAt: i + 1,
      })),
    });
    const { result } = renderHook(() => useLikes());
    act(() => result.current.toggleLike(post(9999)));
    await harness.settle();

    const ids = result.current.likes.map((like) => like.id);
    expect(ids).toHaveLength(MAX_LIKES);
    expect(ids[0]).toBe(2);
    expect(ids.at(-1)).toBe(9999);
  });

  it("shares one id set between components instead of building one each", () => {
    start({
      likes: [{ id: 1, tags: [], score: 0, rating: "", likedAt: 1 }],
    });
    const first = renderHook(() => useLikes()).result.current.likedIds;
    const second = renderHook(() => useLikes()).result.current.likedIds;

    expect(first).toBe(second);
    expect(first.has(1)).toBe(true);
  });

  it("builds a fresh id set once the likes change", async () => {
    const { result } = renderHook(() => useLikes());
    act(() => result.current.toggleLike(post(1)));
    await harness.settle();
    const before = renderHook(() => useLikes()).result.current.likedIds;

    act(() => result.current.toggleLike(post(2)));
    await harness.settle();
    const after = renderHook(() => useLikes()).result.current.likedIds;

    expect(after).not.toBe(before);
    expect([...after]).toEqual([1, 2]);
  });
});

describe("a write that cannot be saved", () => {
  it("takes the change back and warns instead of lying about it", async () => {
    harness.breakWrites();
    const likes = renderHook(() => useLikes());
    const warning = renderHook(() => useStorageWarning());
    expect(warning.result.current).toBe(false);

    act(() => likes.result.current.toggleLike(post(1)));
    expect(likes.result.current.isLiked(1)).toBe(true);

    await harness.settle();
    expect(likes.result.current.isLiked(1)).toBe(false);
    expect(warning.result.current).toBe(true);
    expect(readLikes(harness.db)).toEqual([]);
  });
});

describe("useDismissed", () => {
  it("records a dismissal with its tags", async () => {
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.dismiss(post(5, "x y")));
    await harness.settle();

    expect(result.current.dismissed[0]).toMatchObject({
      id: 5,
      tags: ["x", "y"],
    });
    expect(result.current.dismissedIds.has(5)).toBe(true);
    expect(readDismissed(harness.db)).toHaveLength(1);
  });

  it("ignores a repeat dismissal of the same post", async () => {
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.dismiss(post(5)));
    await harness.settle();
    act(() => result.current.dismiss(post(5)));
    await harness.settle();

    expect(result.current.dismissed).toHaveLength(1);
  });

  it("undismisses a single post and clears them all", async () => {
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.dismiss(post(1)));
    await harness.settle();
    act(() => result.current.dismiss(post(2)));
    await harness.settle();

    act(() => result.current.undismiss(1));
    await harness.settle();
    expect(result.current.dismissed.map((d) => d.id)).toEqual([2]);

    act(() => result.current.clearDismissed());
    await harness.settle();
    expect(result.current.dismissed).toEqual([]);
    expect(readDismissed(harness.db)).toEqual([]);
  });

  it("shares one id set between components", () => {
    start({ dismissed: [{ id: 1, tags: [], dismissedAt: 1 }] });

    expect(renderHook(() => useDismissed()).result.current.dismissedIds).toBe(
      renderHook(() => useDismissed()).result.current.dismissedIds,
    );
  });

  it("caps the list", async () => {
    start({
      dismissed: Array.from({ length: MAX_DISMISSED }, (_, i) => ({
        id: i + 1,
        tags: ["a"],
        dismissedAt: i + 1,
      })),
    });
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.dismiss(post(9999)));
    await harness.settle();

    expect(result.current.dismissed).toHaveLength(MAX_DISMISSED);
    expect(result.current.dismissed[0].id).toBe(2);
  });
});

describe("seen ring buffer", () => {
  it("remembers ids and ignores repeats", async () => {
    recordSeen([1, 2, 3]);
    recordSeen([2, 3, 4]);
    await harness.settle();

    expect([...readSeen()]).toEqual([1, 2, 3, 4]);
    expect(readStoredSeen(harness.db)).toEqual([1, 2, 3, 4]);
  });

  it("writes nothing when there is nothing new", async () => {
    recordSeen([1]);
    await harness.settle();
    const calls = harness.fetchMock.mock.calls.length;

    recordSeen([1]);
    expect(harness.fetchMock.mock.calls).toHaveLength(calls);
  });

  it("hands out a copy, so a feed's snapshot can't shift underneath it", () => {
    recordSeen([1]);
    const snapshot = readSeen();
    recordSeen([2]);

    expect([...snapshot]).toEqual([1]);
  });

  it("keeps only the most recent ids", async () => {
    recordSeen(Array.from({ length: MAX_SEEN + 50 }, (_, i) => i));
    await harness.settle();

    const seen = readStoredSeen(harness.db);
    expect(seen).toHaveLength(MAX_SEEN);
    expect(seen[0]).toBe(50);
  });
});

describe("browser-local settings", () => {
  const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null");

  it("toggles hide-AI and persists it", () => {
    const { result } = renderHook(() => useHideAi());
    expect(result.current[0]).toBe(false);
    act(() => result.current[1]());

    expect(result.current[0]).toBe(true);
    expect(stored("hideAi")).toBe(true);
  });

  it("toggles the mobile column count between 1 and 2", () => {
    const { result } = renderHook(() => useMobileColumns());
    expect(result.current[0]).toBe(2);
    act(() => result.current[1]());

    expect(result.current[0]).toBe(1);
    expect(localStorage.getItem("mobileColumns")).toBe("1");
  });

  it("stores a rating and rejects anything unknown", () => {
    const { result } = renderHook(() => useRating());
    expect(result.current[0]).toBe("");
    act(() => result.current[1]("safe"));
    expect(result.current[0]).toBe("safe");

    act(() => result.current[1]("nonsense" as "safe"));
    expect(result.current[0]).toBe("");
  });

  it("keeps them out of the shared store", () => {
    renderHook(() => useHideAi()).result.current[1]();
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });
});

describe("useSeedTags", () => {
  it("stores seed tags", async () => {
    const { result } = renderHook(() => useSeedTags());
    act(() => result.current.setSeeds(["miku", "vocaloid"]));
    await harness.settle();

    expect(result.current.seeds).toEqual(["miku", "vocaloid"]);
    expect(readSeeds(harness.db)).toEqual(["miku", "vocaloid"]);
  });
});

describe("useBlockedTags", () => {
  it("stores the tags to exclude", async () => {
    const { result } = renderHook(() => useBlockedTags());
    act(() => result.current.setBlockedTags(["gore", "scat"]));
    await harness.settle();

    expect(result.current.blocked).toEqual(["gore", "scat"]);
    expect(readBlockedTags(harness.db)).toEqual(["gore", "scat"]);
  });

  it("normalises a leading minus — the query adds that itself", async () => {
    const { result } = renderHook(() => useBlockedTags());
    act(() => result.current.setBlockedTags(["-gore", " scat "]));
    await harness.settle();

    expect(result.current.blocked).toEqual(["gore", "scat"]);
  });

  it("refuses metatags, which would change a query rather than narrow it", async () => {
    const { result } = renderHook(() => useBlockedTags());
    act(() => result.current.setBlockedTags(["sort:random", "gore"]));
    await harness.settle();

    expect(result.current.blocked).toEqual(["gore"]);
  });

  it("drops duplicates and caps the list so queries stay sendable", async () => {
    const { result } = renderHook(() => useBlockedTags());
    act(() =>
      result.current.setBlockedTags([
        "gore",
        "gore",
        ...Array.from({ length: MAX_BLOCKED_TAGS + 5 }, (_, i) => `t${i}`),
      ]),
    );
    await harness.settle();

    expect(result.current.blocked).toHaveLength(MAX_BLOCKED_TAGS);
    expect(result.current.blocked[0]).toBe("gore");
  });
});

describe("contentFilterTags", () => {
  it("is empty when nothing is filtered", () => {
    expect(contentFilterTags({ rating: "", blocked: [], hideAi: false })).toBe(
      "",
    );
  });

  it("combines the rating, the blacklist and the AI shortcut", () => {
    expect(
      contentFilterTags({
        rating: "safe",
        blocked: ["gore", "scat"],
        hideAi: true,
      }),
    ).toBe("rating:safe -gore -scat -ai_generated");
  });
});
