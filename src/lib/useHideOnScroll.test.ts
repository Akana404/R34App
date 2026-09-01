// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHideOnScroll } from "@/lib/useHideOnScroll";

/** Scrolls the window and lets the rAF-throttled listener run. */
async function scrollTo(y: number) {
  await act(async () => {
    window.scrollY = y;
    window.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  });
}

beforeEach(() => {
  window.scrollY = 0;
});

describe("useHideOnScroll", () => {
  it("stays visible at the top of the page", async () => {
    const { result } = renderHook(() => useHideOnScroll());
    await scrollTo(40);
    expect(result.current).toBe(false);
  });

  it("hides once you scroll down past the top zone", async () => {
    const { result } = renderHook(() => useHideOnScroll());
    await scrollTo(400);
    expect(result.current).toBe(true);
  });

  it("comes back as soon as you scroll up", async () => {
    const { result } = renderHook(() => useHideOnScroll());
    await scrollTo(400);
    await scrollTo(300);
    expect(result.current).toBe(false);
  });

  it("ignores jitter below the movement threshold", async () => {
    const { result } = renderHook(() => useHideOnScroll());
    await scrollTo(400);
    await scrollTo(398);
    expect(result.current).toBe(true);
  });

  it("stays visible while something asks it to be pinned", async () => {
    const { result, rerender } = renderHook(
      ({ pinned }) => useHideOnScroll(pinned),
      { initialProps: { pinned: true } },
    );
    await scrollTo(400);
    expect(result.current).toBe(false);
    // Unpinning reveals the hidden state it had been tracking all along.
    rerender({ pinned: false });
    expect(result.current).toBe(true);
  });

  it("stops listening once unmounted", async () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useHideOnScroll());
    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    remove.mockRestore();
  });
});
