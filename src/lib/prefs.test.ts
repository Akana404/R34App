// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Post } from "@/lib/types";
import {
  MAX_BLOCKED_TAGS,
  MAX_DISMISSED,
  MAX_LIKES,
  MAX_SEEN,
  readPrefsSnapshot,
  readSeen,
  recordSeen,
  useDismissed,
  useHideAi,
  useLikes,
  useMobileColumns,
  useSeedTags,
  useBlockedTags,
  useRating,
  contentFilterTags,
  writePrefsSnapshot,
} from "@/lib/prefs";

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

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null");

beforeEach(() => {
  localStorage.clear();
});

describe("useLikes", () => {
  it("stores the whole post so the Liked page can render it", () => {
    const { result } = renderHook(() => useLikes());
    act(() => result.current.toggleLike(post(1, "miku 1girls")));
    const [like] = stored("forYou:likes");
    expect(like.id).toBe(1);
    expect(like.tags).toEqual(["miku", "1girls"]);
    expect(like.post.file_url).toBe("f");
    expect(result.current.isLiked(1)).toBe(true);
  });

  it("toggles a like off again", () => {
    const { result } = renderHook(() => useLikes());
    act(() => result.current.toggleLike(post(1)));
    act(() => result.current.toggleLike(post(1)));
    expect(result.current.likes).toEqual([]);
  });

  it("does not lose a like when two toggles land in the same tick", () => {
    const { result } = renderHook(() => useLikes());
    act(() => {
      result.current.toggleLike(post(1));
      result.current.toggleLike(post(2));
    });
    expect(stored("forYou:likes").map((l: { id: number }) => l.id)).toEqual([
      1, 2,
    ]);
  });

  it("caps the list, dropping the oldest likes", () => {
    const many = Array.from({ length: MAX_LIKES }, (_, i) => ({
      id: i + 1,
      tags: ["a"],
      score: 1,
      rating: "explicit",
      likedAt: i,
    }));
    localStorage.setItem("forYou:likes", JSON.stringify(many));
    const { result } = renderHook(() => useLikes());
    act(() => result.current.toggleLike(post(9999)));
    const ids = stored("forYou:likes").map((l: { id: number }) => l.id);
    expect(ids).toHaveLength(MAX_LIKES);
    expect(ids[0]).toBe(2);
    expect(ids.at(-1)).toBe(9999);
  });

  it("shares one id set between components instead of building one each", () => {
    const { result } = renderHook(() => useLikes());
    act(() => result.current.toggleLike(post(1)));
    const first = renderHook(() => useLikes()).result.current.likedIds;
    const second = renderHook(() => useLikes()).result.current.likedIds;
    expect(first).toBe(second);
    expect(first.has(1)).toBe(true);
  });

  it("builds a fresh id set once the likes change", () => {
    const { result } = renderHook(() => useLikes());
    act(() => result.current.toggleLike(post(1)));
    const before = renderHook(() => useLikes()).result.current.likedIds;
    act(() => result.current.toggleLike(post(2)));
    const after = renderHook(() => useLikes()).result.current.likedIds;
    expect(after).not.toBe(before);
    expect([...after]).toEqual([1, 2]);
  });

  it("survives a corrupted store instead of crashing the page", () => {
    localStorage.setItem("forYou:likes", "{not json");
    const { result } = renderHook(() => useLikes());
    expect(result.current.likes).toEqual([]);
  });
});

describe("useDismissed", () => {
  it("records a dismissal with its tags", () => {
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.dismiss(post(5, "x y")));
    expect(stored("forYou:dismissed")[0]).toMatchObject({
      id: 5,
      tags: ["x", "y"],
    });
    expect(result.current.dismissedIds.has(5)).toBe(true);
  });

  it("ignores a repeat dismissal of the same post", () => {
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.dismiss(post(5)));
    act(() => result.current.dismiss(post(5)));
    expect(result.current.dismissed).toHaveLength(1);
  });

  it("undismisses a single post and clears them all", () => {
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.dismiss(post(1)));
    act(() => result.current.dismiss(post(2)));
    act(() => result.current.undismiss(1));
    expect(result.current.dismissed.map((d) => d.id)).toEqual([2]);
    act(() => result.current.clearDismissed());
    expect(result.current.dismissed).toEqual([]);
  });

  it("shares one id set between components", () => {
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.dismiss(post(1)));
    expect(renderHook(() => useDismissed()).result.current.dismissedIds).toBe(
      renderHook(() => useDismissed()).result.current.dismissedIds,
    );
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_DISMISSED }, (_, i) => ({
      id: i + 1,
      tags: ["a"],
      dismissedAt: i,
    }));
    localStorage.setItem("forYou:dismissed", JSON.stringify(many));
    const { result } = renderHook(() => useDismissed());
    act(() => result.current.dismiss(post(9999)));
    expect(result.current.dismissed).toHaveLength(MAX_DISMISSED);
    expect(result.current.dismissed[0].id).toBe(2);
  });
});

describe("seen ring buffer", () => {
  it("remembers ids and ignores repeats", () => {
    recordSeen([1, 2, 3]);
    recordSeen([2, 3, 4]);
    expect(stored("forYou:seen")).toEqual([1, 2, 3, 4]);
    expect([...readSeen()]).toEqual([1, 2, 3, 4]);
  });

  it("writes nothing when there is nothing new", () => {
    recordSeen([1]);
    const before = localStorage.getItem("forYou:seen");
    recordSeen([1]);
    expect(localStorage.getItem("forYou:seen")).toBe(before);
  });

  it("keeps only the most recent ids", () => {
    recordSeen(Array.from({ length: MAX_SEEN + 50 }, (_, i) => i));
    const seen = stored("forYou:seen");
    expect(seen).toHaveLength(MAX_SEEN);
    expect(seen[0]).toBe(50);
  });
});

describe("simple preference hooks", () => {
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

  it("stores seed tags", () => {
    const { result } = renderHook(() => useSeedTags());
    act(() => result.current.setSeeds(["miku", "vocaloid"]));
    expect(stored("forYou:seeds")).toEqual(["miku", "vocaloid"]);
  });
});

describe("useBlockedTags", () => {
  it("stores the tags to exclude", () => {
    const { result } = renderHook(() => useBlockedTags());
    act(() => result.current.setBlockedTags(["gore", "scat"]));
    expect(stored("blockedTags")).toEqual(["gore", "scat"]);
  });

  it("normalises a leading minus — the query adds that itself", () => {
    const { result } = renderHook(() => useBlockedTags());
    act(() => result.current.setBlockedTags(["-gore", " scat "]));
    expect(result.current.blocked).toEqual(["gore", "scat"]);
  });

  it("refuses metatags, which would change a query rather than narrow it", () => {
    const { result } = renderHook(() => useBlockedTags());
    act(() => result.current.setBlockedTags(["sort:random", "gore"]));
    expect(result.current.blocked).toEqual(["gore"]);
  });

  it("drops duplicates and caps the list so queries stay sendable", () => {
    const { result } = renderHook(() => useBlockedTags());
    act(() =>
      result.current.setBlockedTags([
        "gore",
        "gore",
        ...Array.from({ length: MAX_BLOCKED_TAGS + 5 }, (_, i) => `t${i}`),
      ]),
    );
    expect(result.current.blocked).toHaveLength(MAX_BLOCKED_TAGS);
    expect(result.current.blocked[0]).toBe("gore");
  });
});

describe("useRating", () => {
  it("stores a rating and rejects anything unknown", () => {
    const { result } = renderHook(() => useRating());
    expect(result.current[0]).toBe("");
    act(() => result.current[1]("safe"));
    expect(result.current[0]).toBe("safe");
    act(() => result.current[1]("nonsense" as "safe"));
    expect(result.current[0]).toBe("");
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

describe("prefs snapshot", () => {
  it("round-trips everything the app persists", () => {
    const snapshot = {
      likes: [
        { id: 1, tags: ["a"], score: 1, rating: "explicit", likedAt: 10 },
      ],
      dismissed: [{ id: 2, tags: ["b"], dismissedAt: 20 }],
      seen: [3, 4],
      seeds: ["miku"],
      blocked: ["gore"],
      rating: "safe" as const,
      hideAi: true,
      mobileColumns: 1 as const,
    };
    writePrefsSnapshot(snapshot);
    expect(readPrefsSnapshot()).toEqual(snapshot);
  });

  it("returns defaults for an untouched install", () => {
    expect(readPrefsSnapshot()).toEqual({
      likes: [],
      dismissed: [],
      seen: [],
      seeds: [],
      blocked: [],
      rating: "",
      hideAi: false,
      mobileColumns: 2,
    });
  });

  it("enforces the caps when writing", () => {
    writePrefsSnapshot({
      likes: Array.from({ length: MAX_LIKES + 10 }, (_, i) => ({
        id: i,
        tags: ["a"],
        score: 1,
        rating: "explicit",
        likedAt: i,
      })),
      dismissed: Array.from({ length: MAX_DISMISSED + 10 }, (_, i) => ({
        id: i,
        tags: ["a"],
        dismissedAt: i,
      })),
      seen: Array.from({ length: MAX_SEEN + 10 }, (_, i) => i),
      seeds: [],
      blocked: Array.from({ length: MAX_BLOCKED_TAGS + 10 }, (_, i) => `b${i}`),
      rating: "",
      hideAi: false,
      mobileColumns: 2,
    });
    const snapshot = readPrefsSnapshot();
    expect(snapshot.likes).toHaveLength(MAX_LIKES);
    expect(snapshot.dismissed).toHaveLength(MAX_DISMISSED);
    expect(snapshot.seen).toHaveLength(MAX_SEEN);
    expect(snapshot.blocked).toHaveLength(MAX_BLOCKED_TAGS);
  });
});
