// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  recordSeen,
  useHideAi,
  useLikes,
  useMobileColumns,
  useStorageWarning,
} from "@/lib/prefs";
import { recordTagInfo } from "@/lib/tagmeta";
import type { Post } from "@/lib/types";
import { installStore, type StoreHarness } from "@/test/store";

/**
 * What happens when a change can't be saved.
 *
 * Two stores can fail for two different reasons: `localStorage` still holds
 * the three per-browser switches and can be full or refuse every write
 * (Safari private mode), and the shared store is a server that can be down.
 * Neither may throw out of a click handler, and both raise the same warning.
 */

function post(id: number): Post {
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
    tags: "a b",
    owner: "o",
    change: 0,
    comment_count: 0,
  };
}

/** Makes `localStorage.setItem` throw, as a full store does. */
function failLocalWrites() {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("quota", "QuotaExceededError");
  });
}

let harness: StoreHarness;

beforeEach(() => {
  localStorage.clear();
  harness = installStore();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("localStorage refusing every write", () => {
  it("does not throw out of the toggle handlers", () => {
    failLocalWrites();
    const hideAi = renderHook(() => useHideAi());
    const columns = renderHook(() => useMobileColumns());

    expect(() => act(() => hideAi.result.current[1]())).not.toThrow();
    expect(() => act(() => columns.result.current[1]())).not.toThrow();
  });

  it("raises the warning after the first failed write", () => {
    const warning = renderHook(() => useStorageWarning());
    expect(warning.result.current).toBe(false);

    failLocalWrites();
    const hideAi = renderHook(() => useHideAi());
    act(() => hideAi.result.current[1]());

    expect(warning.result.current).toBe(true);
  });

  it("stays quiet while writes succeed", () => {
    const warning = renderHook(() => useStorageWarning());
    const hideAi = renderHook(() => useHideAi());
    act(() => hideAi.result.current[1]());

    expect(warning.result.current).toBe(false);
  });
});

describe("the shared store being unreachable", () => {
  it("does not throw out of a click handler", async () => {
    harness.breakWrites();
    const { result } = renderHook(() => useLikes());

    expect(() => act(() => result.current.toggleLike(post(1)))).not.toThrow();
    await harness.settle();
  });

  it("swallows a failed recordSeen — it is advisory, not worth a warning", async () => {
    harness.breakWrites();
    const warning = renderHook(() => useStorageWarning());

    expect(() => recordSeen([1, 2, 3])).not.toThrow();
    await harness.settle();

    expect(warning.result.current).toBe(false);
  });

  it("keeps tag metadata working locally when it can't be written through", async () => {
    harness.breakWrites();
    const warning = renderHook(() => useStorageWarning());

    expect(() =>
      recordTagInfo([{ tag: "t", count: 1, type: "artist" }]),
    ).not.toThrow();
    await harness.settle();

    // A cache: the lookup still coloured this session's tags, and a failure
    // to persist it is not something to put in front of the user.
    expect(warning.result.current).toBe(false);
  });
});
