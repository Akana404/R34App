// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/types";
import type { LikedPost } from "@/lib/prefs";
import { installStore } from "@/test/store";

// The feed's logic lives in the props it hands PostGrid (filterPost,
// rankPost, getPageQueries, feedId); capture them instead of fetching.
interface GridProps {
  feedId?: string;
  getPageQueries?: (page: number) => { tags: string; pid: number }[];
  filterPost?: (post: Post) => boolean;
  rankPost?: (post: Post) => number;
  excludeIds?: ReadonlySet<number>;
}
let grid: GridProps | null = null;
vi.mock("@/components/PostGrid", () => ({
  PostGrid: (props: GridProps) => {
    grid = props;
    return <div data-testid="post-grid" />;
  },
}));

const { ForYouFeed } = await import("@/components/ForYouFeed");

function post(id: number, tags: string): Post {
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
    score: 50,
    tags,
    owner: "o",
    change: 0,
    comment_count: 0,
  };
}

function like(id: number, tags: string[], likedAt = Date.now() - 1000): LikedPost {
  return { id, tags, score: 50, rating: "explicit", likedAt };
}

function seedLikes(likes: LikedPost[]) {
  installStore({ likes });
}

function renderFeed() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ForYouFeed />
    </QueryClientProvider>,
  );
}

/**
 * Five likes with a recurring-but-not-universal tag set: direction pruning
 * drops tags liked only once and tags present in over 80% of likes, so the
 * distinctive ones appear in three of five.
 */
const armedLikes = () => [
  like(1, ["miku_(vocaloid)", "vocaloid", "twintails"]),
  like(2, ["miku_(vocaloid)", "vocaloid", "twintails"]),
  like(3, ["miku_(vocaloid)", "vocaloid", "twintails"]),
  like(4, ["megurine_luka", "vocaloid"]),
  like(5, ["kagamine_rin", "vocaloid"]),
];

beforeEach(() => {
  localStorage.clear();
  installStore();
  grid = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ForYouFeed", () => {
  it("shows the hint instead of a feed while there is no taste at all", () => {
    renderFeed();
    expect(screen.getByText(/like posts while browsing/i)).toBeTruthy();
    expect(screen.queryByTestId("post-grid")).toBeNull();
  });

  it("builds a feed from seed tags alone", () => {
    installStore({ seeds: ["miku_(vocaloid)"] });
    renderFeed();
    expect(screen.queryByTestId("post-grid")).toBeTruthy();
    const queries = grid!.getPageQueries!(0);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.some((q) => q.tags.includes("miku_(vocaloid)"))).toBe(true);
  });

  it("keeps the gate open while the profile is still thin", () => {
    // Below GATE_MIN_LIKES the gate must not filter a fresh user's feed.
    seedLikes([like(1, ["miku_(vocaloid)", "vocaloid"])]);
    renderFeed();
    expect(grid!.filterPost!(post(100, "completely unrelated tags"))).toBe(
      true,
    );
  });

  it("gates unrelated posts out once the profile is meaningful", () => {
    seedLikes(armedLikes());
    renderFeed();
    expect(grid!.filterPost!(post(100, "unrelated other things entirely"))).toBe(
      false,
    );
    expect(
      grid!.filterPost!(post(101, "miku_(vocaloid) vocaloid twintails")),
    ).toBe(true);
  });

  it("hides posts liked before this feed run but not ones liked during it", () => {
    seedLikes([
      ...armedLikes(),
      // Stamped after the feed epoch, the way a mid-scroll like is.
      like(200, ["miku_(vocaloid)"], Date.now() + 60_000),
    ]);
    renderFeed();
    // Liked before the feed mounted: already known, keep it out.
    expect(grid!.filterPost!(post(1, "miku_(vocaloid) vocaloid twintails"))).toBe(
      false,
    );
    // Liked during this run: stays exactly where it is.
    expect(
      grid!.filterPost!(post(200, "miku_(vocaloid) vocaloid twintails")),
    ).toBe(true);
  });

  it("down-ranks posts the feed has shown before instead of hiding them", () => {
    installStore({ likes: armedLikes(), seen: [300] });
    renderFeed();
    const fresh = grid!.rankPost!(post(301, "miku_(vocaloid) vocaloid"));
    const repeat = grid!.rankPost!(post(300, "miku_(vocaloid) vocaloid"));
    expect(repeat).toBeCloseTo(fresh * 0.5);
    expect(grid!.filterPost!(post(300, "miku_(vocaloid) vocaloid twintails"))).toBe(
      true,
    );
  });

  it("passes dismissals through as immediate exclusions", () => {
    installStore({
      likes: armedLikes(),
      dismissed: [{ id: 400, tags: ["x"], dismissedAt: Date.now() }],
    });
    renderFeed();
    expect(grid!.excludeIds!.has(400)).toBe(true);
  });

  it("keeps the feed identity stable until the seeds change", () => {
    installStore({ seeds: ["vocaloid"] });
    const view = renderFeed();
    const before = grid!.feedId;
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ForYouFeed />
      </QueryClientProvider>,
    );
    expect(grid!.feedId).toBe(before);
  });
});
