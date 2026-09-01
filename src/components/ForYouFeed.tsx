"use client";

import { useCallback, useMemo, useState } from "react";
import type { Post } from "@/lib/types";
import { AppHeader } from "@/components/AppHeader";
import { BlockedTagsPanel, RatingSelect } from "@/components/ContentFilters";
import { ShuffleIcon, SlidersIcon } from "@/components/icons";
import { HideAiToggle } from "@/components/HideAiToggle";
import { SearchBar } from "@/components/SearchBar";
import { PostGrid } from "@/components/PostGrid";
import {
  contentFilterTags,
  readSeen,
  recordSeen,
  useDismissed,
  useBlockedTags,
  useHideAi,
  useLikes,
  useMobileColumns,
  useRating,
  useSeedTags,
} from "@/lib/prefs";
import {
  applyDismissals,
  buildForYouQueries,
  computeDirectionWeights,
  computeTagPairs,
  computeTagWeights,
  isMetaTag,
  rankScore,
  scorePost,
  topWeightedTags,
} from "@/lib/recommend";
import { useTagMeta } from "@/lib/tagmeta";

function newShuffleSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

// The relevance gate only kicks in once the profile is meaningful; with fewer
// likes or tags it would filter out most of a fresh user's feed.
const GATE_MIN_LIKES = 5;
const GATE_MIN_PROFILE_TAGS = 4;

export function ForYouFeed() {
  const { seeds, setSeeds } = useSeedTags();
  const { likes } = useLikes();
  const { dismissed, dismissedIds, clearDismissed } = useDismissed();
  const [mobileColumns] = useMobileColumns();
  const [hideAi] = useHideAi();
  const [rating] = useRating();
  const { blocked } = useBlockedTags();
  const [shuffleSeed, setShuffleSeed] = useState(newShuffleSeed);
  // Posts liked before this feed run are excluded; likes made while
  // scrolling stay visible until the next shuffle or reload.
  const [feedEpoch, setFeedEpoch] = useState(() => Date.now());
  const [showTaste, setShowTaste] = useState(false);

  const tagMeta = useTagMeta();
  // Two profiles: `weights` scores every post (recency-decayed, unpruned),
  // `directions` is the narrower pool the feed actually searches on.
  const weights = useMemo(
    () => computeTagWeights(likes, tagMeta),
    [likes, tagMeta],
  );
  const directions = useMemo(
    () => computeDirectionWeights(likes, tagMeta),
    [likes, tagMeta],
  );
  const likedTop = useMemo(() => topWeightedTags(directions, 20), [directions]);
  const pairs = useMemo(
    () => computeTagPairs(likes, directions),
    [likes, directions],
  );

  // Scoring profile: every learned tag, minus what dismissals argue against,
  // plus explicit seeds at top weight so posts from seed-driven sub-queries
  // aren't penalized by the gate.
  const profile = useMemo(() => {
    const map = new Map(applyDismissals(weights, dismissed, tagMeta));
    const seedWeight = Math.max(2, ...likedTop.map((t) => t.weight));
    for (const seed of seeds) {
      if (!isMetaTag(seed)) map.set(seed, seedWeight);
    }
    return map;
  }, [weights, dismissed, tagMeta, likedTop, seeds]);

  // A post must match at least a median-weight tag of the profile — one weak
  // tag in common isn't enough, a pair match or a strong tag/seed passes.
  const gateThreshold = useMemo(() => {
    if (likes.length < GATE_MIN_LIKES || profile.size < GATE_MIN_PROFILE_TAGS) {
      return 0;
    }
    // Median over the positive weights only — dismissal penalties make some
    // entries negative, and they would drag the bar below zero.
    const sorted = [...profile.values()]
      .filter((weight) => weight > 0)
      .sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    return sorted[Math.floor(sorted.length / 2)];
  }, [likes.length, profile]);

  const likedAtById = useMemo(
    () => new Map(likes.map((like) => [like.id, like.likedAt])),
    [likes],
  );

  // Metatag seeds (rating:safe, -rating:explicit, …) only filter; the feed
  // needs at least one real tag or learned tag to build queries from.
  const hasTaste =
    likedTop.length > 0 || seeds.some((seed) => !isMetaTag(seed));

  // Likes are deliberately NOT part of the key: liking mid-scroll only
  // reweights future pages without refetching the feed. Shuffle (or editing
  // seeds) rebuilds it.
  const feedId = `for-you:${shuffleSeed}:${seeds.join(" ")}`;

  // Snapshot of what earlier feed runs already showed, taken once per run:
  // a live set would re-rank posts as they are marked seen, moving them
  // under the reader.
  const seenBefore = useMemo(() => readSeen(), [feedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable identities: PostGrid memoises the assembled post list on these,
  // so inline arrows would rebuild (and re-sort) it on every render.
  const filterPost = useCallback(
    (post: Post) => {
      // Only posts liked *before* this feed run are skipped: liking something
      // while scrolling leaves it exactly where it is.
      const likedAt = likedAtById.get(post.id);
      if (likedAt !== undefined && likedAt < feedEpoch) return false;
      return gateThreshold === 0 || scorePost(post, profile) >= gateThreshold;
    },
    [likedAtById, feedEpoch, gateThreshold, profile],
  );
  const rankPost = useCallback(
    // Already-shown posts aren't hidden — a repeat can still be the best
    // thing on the page — they just stop crowding out fresh material.
    (post: Post) =>
      rankScore(post, profile) * (seenBefore.has(post.id) ? 0.5 : 1),
    [profile, seenBefore],
  );

  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 pb-24 sm:pb-12">
      <AppHeader
        controlsActive={hideAi || showTaste || rating !== "" || blocked.length > 0}
        controls={
          <>
            <RatingSelect />
            <HideAiToggle />
            <button
              data-sheet-close
              onClick={() => {
                setShuffleSeed(newShuffleSeed());
                setFeedEpoch(Date.now());
              }}
              title="Rebuild the feed (also applies new likes)"
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-300 hover:border-neutral-500 sm:min-h-0 sm:w-auto sm:py-1.5"
            >
              <ShuffleIcon className="size-4" />
              Shuffle
            </button>
            <button
              data-sheet-close
              onClick={() => setShowTaste((s) => !s)}
              aria-expanded={showTaste}
              className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-300 hover:border-neutral-500 sm:min-h-0 sm:w-auto sm:py-1.5"
            >
              <SlidersIcon className="size-4" />
              Taste
            </button>
          </>
        }
      />

      {(showTaste || !hasTaste) && (
        <section className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <h2 className="mb-2 text-sm font-semibold text-neutral-300">
            Seed tags
          </h2>
          <SearchBar
            tags={seeds}
            onChange={(next) => {
              // Adding the first seed makes hasTaste flip true; keep the
              // panel open instead of yanking it away mid-edit.
              setShowTaste(true);
              setSeeds(next);
            }}
          />
          <BlockedTagsPanel />
          {dismissed.length > 0 && (
            <p className="mt-4 flex items-center gap-2 text-sm text-neutral-400">
              {dismissed.length} post{dismissed.length === 1 ? "" : "s"} marked
              not interested
              <button
                onClick={clearDismissed}
                className="rounded-lg border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
              >
                Clear
              </button>
            </p>
          )}
          {likedTop.length > 0 && (
            <>
              <h2 className="mb-2 mt-4 text-sm font-semibold text-neutral-300">
                Learned from {likes.length} like{likes.length === 1 ? "" : "s"}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {likedTop.slice(0, 12).map(({ tag, weight }) => (
                  <span
                    key={tag}
                    className="rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-300"
                  >
                    {tag}{" "}
                    <span className="text-neutral-500">
                      ×{weight.toFixed(weight < 10 ? 1 : 0)}
                    </span>
                  </span>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {hasTaste ? (
        <PostGrid
          tags={[]}
          mobileColumns={mobileColumns}
          feedId={feedId}
          getPageQueries={(page) => {
            const queries = buildForYouQueries({
              seeds,
              likedTop,
              pairs,
              page,
              shuffleSeed,
              meta: tagMeta,
            });
            return queries.length > 0
              ? queries
              : [{ tags: "sort:random", pid: page }];
          }}
          extraTags={contentFilterTags({ rating, blocked, hideAi })}
          filterPost={filterPost}
          rankPost={rankPost}
          excludeIds={dismissedIds}
          onPosts={recordSeen}
          dismissable
          endless
          emptyMessage={
            <p className="py-16 text-center text-neutral-500">
              Nothing found for your taste right now — try Shuffle or broader
              seed tags.
            </p>
          }
        />
      ) : (
        <p className="py-16 text-center text-neutral-500">
          Add a few seed tags above or like posts while browsing — the
          feed builds itself from your taste.
        </p>
      )}
    </main>
  );
}
