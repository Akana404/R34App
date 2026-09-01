// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostGrid } from "@/components/PostGrid";
import type { Post } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function post(id: number, tags = `t${id}`): Post {
  return {
    id,
    preview_url: `p${id}`,
    sample_url: `s${id}`,
    file_url: `f${id}.jpg`,
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

/** Serves one response per `/api/posts` call, in order. */
function serve(pages: Post[][]) {
  let call = 0;
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => pages[Math.min(call++, pages.length - 1)],
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Captures the infinite-scroll observer so a test can trigger paging. */
let triggerNextPage: (() => void) | null = null;
function stubIntersectionObserver() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private cb: IntersectionObserverCallback) {
        triggerNextPage = () =>
          this.cb(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
}

function renderGrid(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function shownIds(): number[] {
  return screen
    .queryAllByRole("img")
    .map((img) => Number(img.getAttribute("alt")!.replace("post ", "")));
}

const requestedUrls = () =>
  vi.mocked(globalThis.fetch).mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  localStorage.clear();
  triggerNextPage = null;
  stubIntersectionObserver();
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

describe("PostGrid", () => {
  it("shows the posts a search returns", async () => {
    serve([[post(1), post(2)]]);
    renderGrid(<PostGrid tags={["miku"]} mobileColumns={1} />);
    await waitFor(() => expect(shownIds()).toEqual([1, 2]));
    expect(requestedUrls()[0]).toContain("tags=miku");
  });

  it("appends the extra tags to every query", async () => {
    serve([[post(1)]]);
    renderGrid(
      <PostGrid tags={["miku"]} extraTags="-ai_generated" mobileColumns={1} />,
    );
    await waitFor(() => expect(shownIds()).toEqual([1]));
    expect(decodeURIComponent(requestedUrls()[0])).toContain(
      "miku -ai_generated",
    );
  });

  it("drops posts the API repeats on the next page", async () => {
    serve([[post(1), post(2)], [post(2), post(3)]]);
    renderGrid(<PostGrid tags={["a"]} mobileColumns={1} endless />);
    await waitFor(() => expect(shownIds()).toEqual([1, 2]));
    triggerNextPage!();
    await waitFor(() => expect(shownIds()).toEqual([1, 2, 3]));
  });

  it("hides what the filter rejects", async () => {
    serve([[post(1), post(2), post(3)]]);
    renderGrid(
      <PostGrid tags={["a"]} filterPost={(p) => p.id !== 2} mobileColumns={1} />,
    );
    await waitFor(() => expect(shownIds()).toEqual([1, 3]));
  });

  it("orders each page by rank, best first", async () => {
    serve([[post(1), post(2), post(3)]]);
    renderGrid(
      <PostGrid tags={["a"]} rankPost={(p) => p.id} mobileColumns={1} />,
    );
    await waitFor(() => expect(shownIds()).toEqual([3, 2, 1]));
  });

  it("ranks within a page only, so a later page never reorders an earlier one", async () => {
    serve([
      [post(1), post(2)],
      [post(10), post(11)],
    ]);
    renderGrid(
      <PostGrid tags={["a"]} rankPost={(p) => p.id} mobileColumns={1} endless />,
    );
    await waitFor(() => expect(shownIds()).toEqual([2, 1]));
    triggerNextPage!();
    // The high-ranked new posts stay behind the ones already on screen.
    await waitFor(() => expect(shownIds()).toEqual([2, 1, 11, 10]));
  });

  it("keeps a page's order when the ranking changes under it", async () => {
    serve([[post(1), post(2), post(3)]]);
    const { rerender } = renderGrid(
      <PostGrid tags={["a"]} rankPost={(p) => p.id} mobileColumns={1} />,
    );
    await waitFor(() => expect(shownIds()).toEqual([3, 2, 1]));
    // Liking a post rewrites the profile, and with it the ranking function —
    // the posts already on screen must not be reshuffled underneath.
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PostGrid tags={["a"]} rankPost={(p) => -p.id} mobileColumns={1} />
      </QueryClientProvider>,
    );
    expect(shownIds()).toEqual([3, 2, 1]);
  });

  it("keeps a page's posts when the filter changes under it", async () => {
    serve([[post(1), post(2), post(3)]]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <PostGrid tags={["a"]} filterPost={() => true} mobileColumns={1} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(shownIds()).toEqual([1, 2, 3]));
    rerender(
      <QueryClientProvider client={client}>
        <PostGrid tags={["a"]} filterPost={() => false} mobileColumns={1} />
      </QueryClientProvider>,
    );
    expect(shownIds()).toEqual([1, 2, 3]);
  });

  it("applies a new filter to the next page only", async () => {
    serve([
      [post(1), post(2)],
      [post(10), post(11)],
    ]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const grid = (filter: (p: Post) => boolean) => (
      <QueryClientProvider client={client}>
        <PostGrid
          tags={["a"]}
          filterPost={filter}
          mobileColumns={1}
          endless
        />
      </QueryClientProvider>
    );
    const { rerender } = render(grid(() => true));
    await waitFor(() => expect(shownIds()).toEqual([1, 2]));
    rerender(grid((p) => p.id !== 11));
    triggerNextPage!();
    await waitFor(() => expect(shownIds()).toEqual([1, 2, 10]));
  });

  it("drops excluded posts immediately, however the page was decided", async () => {
    serve([[post(1), post(2), post(3)]]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <PostGrid tags={["a"]} mobileColumns={1} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(shownIds()).toEqual([1, 2, 3]));
    rerender(
      <QueryClientProvider client={client}>
        <PostGrid tags={["a"]} mobileColumns={1} excludeIds={new Set([2])} />
      </QueryClientProvider>,
    );
    expect(shownIds()).toEqual([1, 3]);
  });

  it("reports the posts it is showing, for the seen buffer", async () => {
    serve([[post(1), post(2)]]);
    const onPosts = vi.fn();
    renderGrid(<PostGrid tags={["a"]} onPosts={onPosts} />);
    await waitFor(() => expect(onPosts).toHaveBeenCalledWith([1, 2]));
  });

  it("uses the caller's sub-queries and interleaves their results", async () => {
    serve([[post(1), post(3)], [post(2), post(4)]]);
    renderGrid(
      <PostGrid
        tags={[]}
        feedId="for-you"
        mobileColumns={1}
        getPageQueries={() => [
          { tags: "a", pid: 0 },
          { tags: "b", pid: 1 },
        ]}
      />,
    );
    await waitFor(() => expect(shownIds()).toEqual([1, 2, 3, 4]));
    expect(requestedUrls()).toHaveLength(2);
  });

  it("explains an empty result instead of showing a blank page", async () => {
    serve([[]]);
    renderGrid(<PostGrid tags={["nothing"]} />);
    await waitFor(() =>
      expect(screen.getByText(/No results for “nothing”/)).toBeTruthy(),
    );
  });

  it("shows a custom empty message when one is given", async () => {
    serve([[]]);
    renderGrid(<PostGrid tags={["a"]} emptyMessage={<p>Nothing for you</p>} />);
    await waitFor(() => expect(screen.getByText("Nothing for you")).toBeTruthy());
  });

  it("tells the user when the API is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );
    renderGrid(<PostGrid tags={["a"]} />);
    await waitFor(() =>
      expect(screen.getByText(/Failed to load posts/)).toBeTruthy(),
    );
  });

  it("keeps the posts it has when a later page fails", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<unknown> => {
        call += 1;
        if (call === 1) return { ok: true, json: async () => [post(1), post(2)] };
        return { ok: false, json: async () => ({}) };
      }),
    );
    renderGrid(<PostGrid tags={["a"]} mobileColumns={1} endless />);
    await waitFor(() => expect(shownIds()).toEqual([1, 2]));
    triggerNextPage!();
    await waitFor(() =>
      expect(screen.getByText(/Couldn't load more posts/)).toBeTruthy(),
    );
    // The posts already on screen survive — the lightbox stays open on them.
    expect(shownIds()).toEqual([1, 2]);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("gives the page over to the error only when it has nothing to show", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<unknown> => ({ ok: false, json: async () => ({}) })),
    );
    renderGrid(<PostGrid tags={["a"]} mobileColumns={1} />);
    await waitFor(() =>
      expect(screen.getByText(/Failed to load posts/)).toBeTruthy(),
    );
  });

  it("says it is rate-limited rather than blaming the API for being down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<unknown> => ({
        ok: false,
        status: 429,
        json: async () => ({}),
      })),
    );
    renderGrid(<PostGrid tags={["a"]} mobileColumns={1} />);
    await waitFor(() =>
      expect(screen.getByText(/rate-limiting requests/)).toBeTruthy(),
    );
  });

  it("explains the .env setup when the server has no credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (): Promise<unknown> => ({
        ok: false,
        status: 503,
        json: async () => ({ error: "not configured" }),
      })),
    );
    renderGrid(<PostGrid tags={["a"]} mobileColumns={1} />);
    await waitFor(() =>
      expect(screen.getByText(/add your API credentials/i)).toBeTruthy(),
    );
    // Setup guidance, not the misleading "the API may be down".
    expect(screen.queryByText(/API may be down/)).toBeNull();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("stops paging when a page comes back short", async () => {
    serve([[post(1)]]);
    renderGrid(<PostGrid tags={["a"]} />);
    await waitFor(() => expect(screen.getByText(/End of results/)).toBeTruthy());
  });
});
