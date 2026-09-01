"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PAGE_SIZE, type Post } from "@/lib/types";
import {
  MasonryColumns,
  useColumnCount,
  type MobileColumns,
} from "./MasonryColumns";

export type { MobileColumns } from "./MasonryColumns";

// Endless feeds (rotating queries) stop after this many pages, or once the
// last few pages stopped contributing anything new.
const MAX_ENDLESS_PAGES = 40;
const ENDLESS_STALE_PAGES = 3;

/** Thrown so the grid can say "slow down" rather than "the API is down". */
class RateLimited extends Error {}
/** Thrown so the grid can explain the .env setup rather than blame the API. */
class NotConfigured extends Error {}

async function getPosts(
  tags: string,
  page: number,
  limit?: number,
): Promise<Post[]> {
  const limitParam = limit ? `&limit=${limit}` : "";
  const res = await fetch(
    `/api/posts?tags=${encodeURIComponent(tags)}&page=${page}${limitParam}`,
  );
  if (res.status === 429) throw new RateLimited("rate limited");
  if (res.status === 503) throw new NotConfigured("not configured");
  if (!res.ok) throw new Error("failed to load posts");
  return res.json();
}

interface PostGridProps {
  tags: string[];
  mobileColumns?: MobileColumns;
  /** Extra query-key segment so custom feeds get their own cache entry. */
  feedId?: string;
  /**
   * Override the queries per infinite-scroll page (For You blends several
   * rotating sub-queries); their results are interleaved round-robin.
   */
  getPageQueries?: (
    page: number,
  ) => { tags: string; pid: number; limit?: number }[];
  /** Appended to every query (sort:… metatags, -ai_generated, …). */
  extraTags?: string;
  /** Drop posts from the grid (e.g. already-liked ones) without refetching. */
  filterPost?: (post: Post) => boolean;
  /**
   * Order posts within each fetched page, best first. Ranking is per page,
   * never across the whole list: a global sort would reshuffle posts the
   * user is already looking at when the next page arrives.
   */
  rankPost?: (post: Post) => number;
  /**
   * Posts to drop on every render, whatever a page decided when it arrived —
   * for actions that must take effect immediately, like "not interested".
   */
  excludeIds?: ReadonlySet<number>;
  /** Called with the ids currently assembled, e.g. to remember what was shown. */
  onPosts?: (ids: number[]) => void;
  /** Offer "not interested" on each card (For You). */
  dismissable?: boolean;
  /** Keep paging past short pages — rotating queries rarely fill a page. */
  endless?: boolean;
  emptyMessage?: ReactNode;
}

export function PostGrid({
  tags,
  mobileColumns = 2,
  feedId,
  getPageQueries,
  extraTags,
  filterPost,
  rankPost,
  excludeIds,
  onPosts,
  dismissable = false,
  endless = false,
  emptyMessage,
}: PostGridProps) {
  const tagString = tags.join(" ");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const columnCount = useColumnCount(mobileColumns);

  const {
    data,
    error,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ["posts", feedId ?? "", tagString, extraTags ?? ""],
    queryFn: async ({ pageParam }) => {
      const queries = getPageQueries
        ? getPageQueries(pageParam)
        : [{ tags: tagString, pid: pageParam }];
      const results = await Promise.allSettled(
        queries.map((query) => {
          const tags = extraTags
            ? `${query.tags} ${extraTags}`.trim()
            : query.tags;
          return getPosts(tags, query.pid, query.limit);
        }),
      );
      const pages = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => r.value);
      if (pages.length === 0 && results.length > 0) {
        throw (results[0] as PromiseRejectedResult).reason;
      }
      // Interleave round-robin so the visible page mixes all sub-queries
      // instead of showing them in blocks.
      const merged: Post[] = [];
      const longest = Math.max(0, ...pages.map((p) => p.length));
      for (let i = 0; i < longest; i++) {
        for (const page of pages) {
          if (i < page.length) merged.push(page[i]);
        }
      }
      return merged;
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      if (!endless) {
        return lastPage.length < PAGE_SIZE ? undefined : pages.length;
      }
      if (pages.length >= MAX_ENDLESS_PAGES) return undefined;
      // Stop once the last few pages contributed no posts we hadn't seen.
      if (pages.length >= ENDLESS_STALE_PAGES) {
        const seen = new Set<number>();
        for (const page of pages.slice(0, -ENDLESS_STALE_PAGES)) {
          for (const post of page) seen.add(post.id);
        }
        let fresh = 0;
        for (const page of pages.slice(-ENDLESS_STALE_PAGES)) {
          for (const post of page) {
            if (!seen.has(post.id)) {
              seen.add(post.id);
              fresh++;
            }
          }
        }
        if (fresh === 0) return undefined;
      }
      return pages.length;
    },
  });

  /**
   * What each fetched page contributed, cached against that page's identity.
   *
   * Filtering and ranking depend on the taste profile, which changes the
   * moment you like something — re-running them over pages already on screen
   * reshuffled (and could drop) posts the reader was looking at. Deciding
   * once per page, when it arrives, keeps the feed still; new likes steer the
   * pages that come after, which is what "reweights future pages" meant all
   * along.
   */
  // Held in state, not a ref: this is read during render, and a WeakMap
  // created once per grid keeps the entries tied to the pages themselves.
  const [pageResults] = useState(
    () => new WeakMap<Post[], { ids: number[]; kept: Post[] }>(),
  );

  const posts = useMemo(() => {
    const cache = pageResults;
    // The API can return the same post on consecutive pages; dedupe by id.
    const seen = new Set<number>();
    const all: Post[] = [];
    for (const page of data?.pages ?? []) {
      let result = cache.get(page);
      if (!result) {
        const ids: number[] = [];
        const kept: Post[] = [];
        for (const post of page) {
          ids.push(post.id);
          if (seen.has(post.id)) continue;
          if (!filterPost || filterPost(post)) kept.push(post);
        }
        if (rankPost) {
          const ranks = new Map(kept.map((post) => [post.id, rankPost(post)]));
          kept.sort((a, b) => ranks.get(b.id)! - ranks.get(a.id)!);
        }
        result = { ids, kept };
        cache.set(page, result);
      }
      for (const id of result.ids) seen.add(id);
      all.push(...result.kept);
    }
    return excludeIds ? all.filter((post) => !excludeIds.has(post.id)) : all;
  }, [data, filterPost, rankPost, excludeIds, pageResults]);

  useEffect(() => {
    if (posts.length > 0) onPosts?.(posts.map((post) => post.id));
  }, [posts, onPosts]);

  // The lightbox holds the page still, so its scroll sentinel never fires;
  // it asks for the next page through this instead.
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { rootMargin: "800px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // `posts.length` is in here because the sentinel only exists once there
    // is something to render: without it the observer is never attached on a
    // feed whose first page already ends the list.
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, posts.length]);

  if (isLoading) {
    return (
      <div className="flex gap-3 sm:gap-4">
        {Array.from({ length: columnCount }).map((_, col) => (
          <div key={col} className="flex min-w-0 flex-1 flex-col gap-3 sm:gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl bg-neutral-800"
                style={{ height: `${180 + (((col * 4 + i) * 97) % 160)}px` }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  // Only give the page over to the error when there is nothing to show: a
  // later page failing must not take the posts already on screen with it —
  // it used to, which closed the lightbox mid-browse.
  const rateLimited = error instanceof RateLimited;

  if (error instanceof NotConfigured && posts.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-16">
        <h2 className="mb-3 text-lg font-semibold text-neutral-100">
          Almost there — add your API credentials
        </h2>
        <p className="mb-4 text-sm text-neutral-400">
          The rule34 API needs a key. Log in at rule34.xxx, open{" "}
          <span className="text-neutral-200">
            My Account → Options → API Access Credentials
          </span>{" "}
          and generate one. Then create a file called{" "}
          <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-200">
            .env
          </code>{" "}
          next to <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-200">package.json</code>:
        </p>
        <pre className="mb-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-300">
          {"API_KEY=your-api-key\nUSER_ID=your-user-id"}
        </pre>
        <p className="mb-4 text-sm text-neutral-400">
          Restart the server afterwards (<code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-200">npm run dev</code>) — the key stays on
          the server and never reaches the browser.
        </p>
        <button
          onClick={() => refetch()}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm text-neutral-200 hover:border-neutral-500"
        >
          Check again
        </button>
      </div>
    );
  }

  if (error && posts.length === 0) {
    return (
      <p className="py-16 text-center text-neutral-400">
        {rateLimited
          ? "The rule34 API is rate-limiting requests. Give it a moment."
          : "Failed to load posts. The API may be down — try again in a moment."}
      </p>
    );
  }

  if (posts.length === 0) {
    // The first page can be entirely filtered out (e.g. all liked); keep the
    // sentinel around so the observer can still pull further pages.
    if (hasNextPage || isFetchingNextPage) {
      return (
        <>
          <p className="py-16 text-center text-sm text-neutral-500">
            Loading more…
          </p>
          <div ref={sentinelRef} className="h-1" />
        </>
      );
    }
    return (
      emptyMessage ?? (
        <p className="py-16 text-center text-neutral-500">
          No results{tagString ? ` for “${tagString}”` : ""}.
        </p>
      )
    );
  }

  return (
    <>
      <MasonryColumns
        posts={posts}
        mobileColumns={mobileColumns}
        dismissable={dismissable}
        hasMore={hasNextPage && !error}
        loadingMore={isFetchingNextPage}
        pagesLoaded={data?.pages.length ?? 0}
        onNeedMore={loadMore}
      />
      <div ref={sentinelRef} className="h-1" />
      {isFetchingNextPage && (
        <p className="py-6 text-center text-sm text-neutral-500">Loading more…</p>
      )}
      {error && !isFetchingNextPage && (
        <p className="flex items-center justify-center gap-3 py-6 text-center text-sm text-neutral-400">
          {rateLimited
            ? "Rate-limited by the API."
            : "Couldn't load more posts."}
          <button
            onClick={() => fetchNextPage()}
            className="rounded-lg border border-neutral-700 px-3 py-1 text-neutral-300 hover:border-neutral-500"
          >
            Retry
          </button>
        </p>
      )}
      {!hasNextPage && !error && (
        <p className="py-6 text-center text-sm text-neutral-600">End of results.</p>
      )}
    </>
  );
}
