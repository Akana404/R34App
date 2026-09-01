"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { Post } from "@/lib/types";
import { Lightbox } from "./Lightbox";
import { PostCard } from "./PostCard";

export type MobileColumns = 1 | 2;

// Mirrors the Tailwind breakpoints previously used as columns-* classes.
const BREAKPOINTS = [
  { query: "(min-width: 1280px)", columns: 5 },
  { query: "(min-width: 1024px)", columns: 4 },
  { query: "(min-width: 640px)", columns: 3 },
] as const;

function subscribeToBreakpoints(callback: () => void) {
  const lists = BREAKPOINTS.map(({ query }) => window.matchMedia(query));
  for (const list of lists) list.addEventListener("change", callback);
  return () => {
    for (const list of lists) list.removeEventListener("change", callback);
  };
}

export function useColumnCount(mobileColumns: MobileColumns): number {
  return useSyncExternalStore(
    subscribeToBreakpoints,
    () =>
      BREAKPOINTS.find(({ query }) => window.matchMedia(query).matches)
        ?.columns ?? mobileColumns,
    () => 2,
  );
}

interface MasonryColumnsProps {
  posts: Post[];
  mobileColumns?: MobileColumns;
  /** Offer "not interested" on cards and in the lightbox (For You). */
  dismissable?: boolean;
  /** Paging, so the lightbox can walk past the posts loaded so far. */
  hasMore?: boolean;
  loadingMore?: boolean;
  /** Pages fetched so far — the lightbox's prefetch guard keys off this. */
  pagesLoaded?: number;
  onNeedMore?: () => void;
}

export function MasonryColumns({
  posts,
  mobileColumns = 2,
  dismissable = false,
  hasMore,
  loadingMore,
  pagesLoaded,
  onNeedMore,
}: MasonryColumnsProps) {
  const columnCount = useColumnCount(mobileColumns);
  // Index into `posts`, not into a column: the lightbox pages through the
  // feed in load order, which is what the grid reading order implies.
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  // Assign each post to the currently shortest column. This is deterministic
  // over a stable prefix, so appending pages never moves existing posts —
  // unlike CSS multi-columns, which rebalance the whole list on every change.
  const columns = useMemo(() => {
    const cols: { post: Post; index: number }[][] = Array.from(
      { length: columnCount },
      () => [],
    );
    const heights = new Array<number>(columnCount).fill(0);
    posts.forEach((post, index) => {
      const i = heights.indexOf(Math.min(...heights));
      cols[i].push({ post, index });
      // Rendered height is proportional to aspect ratio at equal column width.
      heights[i] += post.height / Math.max(1, post.width);
    });
    return cols;
  }, [posts, columnCount]);

  return (
    <>
      <div className="flex gap-3 sm:gap-4">
        {columns.map((col, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col gap-3 sm:gap-4">
            {col.map(({ post, index }) => (
              <PostCard
                key={post.id}
                post={post}
                dismissable={dismissable}
                onOpen={() => setOpenIndex(index)}
              />
            ))}
          </div>
        ))}
      </div>

      {openIndex !== null && (
        <Lightbox
          posts={posts}
          index={openIndex}
          dismissable={dismissable}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
          hasMore={hasMore}
          loadingMore={loadingMore}
          pagesLoaded={pagesLoaded}
          onNeedMore={onNeedMore}
        />
      )}
    </>
  );
}
