// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LikesView } from "@/components/LikesView";
import type { Post } from "@/lib/types";

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

function seed(entries: { id: number; tags: string; likedAt: number }[]) {
  localStorage.setItem(
    "forYou:likes",
    JSON.stringify(
      entries.map(({ id, tags, likedAt }) => ({
        id,
        tags: tags.split(" "),
        score: 1,
        rating: "explicit",
        likedAt,
        post: post(id, tags),
      })),
    ),
  );
}

/** Rendered post ids in DOM order (single column keeps feed order). */
const shownIds = () =>
  screen
    .getAllByRole("img")
    .map((img) => Number(img.getAttribute("alt")!.replace("post ", "")));

beforeEach(() => {
  localStorage.clear();
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
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Filter likes by tag"), "miku twin");
    expect(shownIds()).toEqual([1]);
  });

  it("says the filter matched nothing rather than 'nothing here yet'", async () => {
    seed([{ id: 1, tags: "miku", likedAt: 1 }]);
    render(<LikesView />);
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
    expect(shownIds()).toEqual([2, 1]);
    await userEvent
      .setup()
      .click(screen.getAllByRole("button", { name: /Newest first/ })[0]);
    expect(shownIds()).toEqual([1, 2]);
  });
});
