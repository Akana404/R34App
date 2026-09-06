"use client";

import { useEffect, useRef } from "react";
import { useLikes } from "@/lib/prefs";
import { fetchTagMetaForPost, loadTagMeta, readTagMeta } from "@/lib/tagmeta";

/** Pause between lookups — this is a background nicety, not a race. */
const DELAY_MS = 1500;
/** After a failed lookup (a 429, a flaky network), stand back a while
 * instead of hammering on at the regular pace. */
const ERROR_BACKOFF_MS = 60_000;
/** A post counts as covered once most of its tags are known. */
const COVERAGE = 0.8;

/**
 * Fills the tag metadata store from liked posts, one lookup at a time.
 *
 * The feed itself can't carry `fields=tag_info` — it would add ~250KB per
 * 100-post page — but a liked post is a single small request, and its tags
 * are exactly the ones the taste profile is built from.
 */
export function TagMetaSync() {
  const { likes } = useLikes();
  // Posts that genuinely have no tag info: don't retry them forever.
  // (Failed requests are transient and stay retryable.)
  const skip = useRef(new Set<number>());

  // Each `likes` change cancels the previous crawl and starts over; the
  // coverage check makes the restart cheap, and cancellation (rather than a
  // "running" flag, which the async loop kept clobbering) means two crawls
  // can never run side by side.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pause = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    function uncovered(like: (typeof likes)[number]): boolean {
      if (skip.current.has(like.id) || like.tags.length === 0) return false;
      // Read the store directly rather than subscribing: every lookup writes
      // to it, and a subscription would restart this loop on each write.
      const meta = readTagMeta();
      const known = like.tags.filter((tag) => meta.has(tag)).length;
      return known / like.tags.length < COVERAGE;
    }

    (async () => {
      // Wait for the stored cache, or the first pass re-fetches tags the
      // store already knows about.
      await loadTagMeta();
      if (cancelled) return;
      // Newest likes first: they matter most to the current profile.
      for (const like of [...likes].reverse()) {
        if (cancelled) break;
        if (!uncovered(like)) continue;
        try {
          const ok = await fetchTagMetaForPost(like.id);
          if (!ok) skip.current.add(like.id);
          if (cancelled) break;
          await pause(DELAY_MS);
        } catch {
          if (cancelled) break;
          await pause(ERROR_BACKOFF_MS);
        }
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [likes]);

  return null;
}
