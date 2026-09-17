// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LikesView } from "@/components/LikesView";
import type { Post } from "@/lib/types";
import { installStore, type StoreHarness } from "@/test/store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/likes",
}));

function post(id: number, tags: string): Post {
  return {
    id,
    preview_url: `p${id}`,
    sample_url: `s${id}`,
    file_url: `f${id}`,
    width: 100,
    height: 100,
    sample_width: 100,
    sample_height: 100,
    rating: "explicit",
    score: 1,
    tags,
    owner: "o",
    change: 0,
    comment_count: 0,
  };
}

let harness: StoreHarness;

function seed(entries: { id: number; tags: string; likedAt: number }[]) {
  harness = installStore({
    likes: entries.map(({ id, tags, likedAt }) => ({
      id,
      tags: tags.split(" "),
      score: 1,
      rating: "explicit",
      likedAt,
      post: post(id, tags),
    })),
  });
}

/** Rendered post ids in DOM order (single column keeps feed order). */
const shownIds = () =>
  screen
    .getAllByRole("img")
    .map((img) => Number(img.getAttribute("alt")!.replace("post ", "")));

beforeEach(() => {
  localStorage.clear();
  harness = installStore();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LikesView", () => {
  it("filters the grid by tag, all terms required", async () => {
    seed([
      { id: 1, tags: "miku_(vocaloid) twintails", likedAt: 1 },
      { id: 2, tags: "megurine_luka vocaloid", likedAt: 2 },
    ]);
    render(<LikesView />);
    // The posts behind the likes arrive in a second request.
    await harness.settle();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Filter likes by tag"), "miku twin");
    expect(shownIds()).toEqual([1]);
  });

  it("says the filter matched nothing rather than 'nothing here yet'", async () => {
    seed([{ id: 1, tags: "miku", likedAt: 1 }]);
    render(<LikesView />);
    // The posts behind the likes arrive in a second request.
    await harness.settle();
    await userEvent.setup().type(
      screen.getByLabelText("Filter likes by tag"),
      "zzz",
    );
    expect(screen.getByText(/No liked posts match/)).toBeTruthy();
  });

  it("flips between newest-first and oldest-first", async () => {
    seed([
      { id: 1, tags: "a", likedAt: 100 },
      { id: 2, tags: "b", likedAt: 200 },
    ]);
    render(<LikesView />);
    // The posts behind the likes arrive in a second request.
    await harness.settle();
    expect(shownIds()).toEqual([2, 1]);
    await userEvent
      .setup()
      .click(screen.getAllByRole("button", { name: /Newest first/ })[0]);
    expect(shownIds()).toEqual([1, 2]);
  });

  it("says it is loading rather than claiming there is nothing", () => {
    seed([{ id: 1, tags: "a", likedAt: 1 }]);
    render(<LikesView />);

    // No settle(): the likes are known, their posts are still in flight.
    expect(screen.getByText(/Loading your liked posts/)).toBeTruthy();
  });

  it("offers the backup as a download", () => {
    render(<LikesView />);
    const links = screen.getAllByRole("link", { name: /Export/ });
    expect(links[0].getAttribute("href")).toBe("/api/backup");
    expect(links[0].hasAttribute("download")).toBe(true);
  });

  it("imports a backup only after confirming, then reloads", async () => {
    const upload = vi
      .fn<(body: unknown) => unknown>()
      .mockReturnValue({ likes: 2, dismissed: 0, seeds: 0, blocked: 0 });
    harness.route("/api/backup", (_url, init) => upload(init?.body));
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const reload = vi.fn();
    const location = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...location, reload },
    });

    try {
      render(<LikesView />);
      const user = userEvent.setup();
      const input = screen.getAllByLabelText("Backup file to import")[0];
      const file = new File(['{"data":{"likes":[]}}'], "backup.json", {
        type: "application/json",
      });

      await user.upload(input as HTMLInputElement, file);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(upload).not.toHaveBeenCalled();

      confirm.mockReturnValue(true);
      await user.upload(input as HTMLInputElement, file);
      await harness.settle();

      expect(upload).toHaveBeenCalledWith('{"data":{"likes":[]}}');
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: location,
      });
    }
  });

  it("tells a genuinely empty store apart from a loading one", async () => {
    render(<LikesView />);
    await harness.settle();

    expect(screen.getByText(/Nothing here yet/)).toBeTruthy();
  });
});
