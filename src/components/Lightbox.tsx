"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isVideo, type Post } from "@/lib/types";
import { useDismissed, useLikes } from "@/lib/prefs";
import { distinctiveTags } from "@/lib/recommend";
import { ensureTagMeta, groupTagsByCategory, useTagMeta } from "@/lib/tagmeta";
import { useFocusTrap } from "@/lib/useFocusTrap";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ExternalLinkIcon,
  HeartIcon,
  NotInterestedIcon,
  SimilarIcon,
  SlidersIcon,
  StarIcon,
} from "./icons";

interface LightboxProps {
  posts: Post[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** Offer "not interested" — only feeds that learn from it pass this. */
  dismissable?: boolean;
  /** The feed has further pages to fetch. */
  hasMore?: boolean;
  /** A page is on its way. */
  loadingMore?: boolean;
  /**
   * Pages fetched so far. The prefetch guard keys off this, not
   * `posts.length`: a page can arrive entirely filtered out, which would
   * otherwise look like "nothing happened" and block paging forever.
   */
  pagesLoaded?: number;
  /** Ask the feed for its next page; the grid's scroll sentinel can't fire
   * while the viewer holds the page still. */
  onNeedMore?: () => void;
}

/** Horizontal travel that counts as a swipe; below it the gesture is a tap. */
const SWIPE_PX = 60;

/** Start fetching this many posts before the end, so paging feels seamless. */
const PREFETCH_WITHIN = 4;

/** Booru-style colours: who drew it, who is in it, what it is from. */
const CATEGORY_STYLE: Record<string, string> = {
  artist: "bg-rose-500/15 text-rose-200 hover:bg-rose-500/25",
  character: "bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25",
  copyright: "bg-violet-500/15 text-violet-200 hover:bg-violet-500/25",
  metadata: "bg-neutral-800/60 text-neutral-400 hover:bg-neutral-700/60",
  tag: "bg-neutral-800 text-neutral-300 hover:bg-neutral-700",
};

const CATEGORY_LABEL: Record<string, string> = {
  artist: "Artist",
  character: "Character",
  copyright: "From",
  metadata: "Meta",
  tag: "Tags",
};

export function Lightbox({
  posts,
  index,
  onIndexChange,
  onClose,
  dismissable = false,
  hasMore = false,
  loadingMore = false,
  pagesLoaded,
  onNeedMore,
}: LightboxProps) {
  const router = useRouter();
  const { isLiked, toggleLike } = useLikes();
  const { dismiss } = useDismissed();
  const tagMeta = useTagMeta();
  const panelRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // The index is allowed past the posts loaded so far: stepping off the end
  // of a feed that has more pages lands on a "loading" frame, which becomes
  // the post as soon as the page arrives. Storing a "waiting" flag instead
  // would mean setting state from an effect on every page that lands.
  const post: Post | undefined = posts[index];
  const beyondLoaded = index >= posts.length;
  const hasPrev = index > 0;
  const hasNext = index < posts.length - 1 || hasMore;

  // A different post can land at the current index without navigation: a
  // dismissal removes the current post from the feed, and paging turns a
  // loading frame into a post — so `loaded` tracks the post's identity,
  // not just the index.
  // The full file can be gone from the CDN while the sample survives.
  const [fileFailed, setFileFailed] = useState(false);
  const [shownId, setShownId] = useState(post?.id);
  if (post?.id !== shownId) {
    setShownId(post?.id);
    setLoaded(false);
    setFileFailed(false);
  }

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0) return;
      if (next >= posts.length && !hasMore) return;
      onIndexChange(next);
    },
    [index, posts.length, hasMore, onIndexChange],
  );

  // Fetch ahead so paging rarely has to wait. One request per page that
  // arrives: without this guard the effect re-fires on every render while a
  // request is pending or has failed, which turns into a request storm.
  const requestedAt = useRef(-1);
  // Without `pagesLoaded` (feeds that don't page) fall back to the post
  // count as the "something arrived" marker.
  const pageMark = pagesLoaded ?? posts.length;
  useEffect(() => {
    if (
      hasMore &&
      !loadingMore &&
      index >= posts.length - PREFETCH_WITHIN &&
      requestedAt.current !== pageMark
    ) {
      requestedAt.current = pageMark;
      onNeedMore?.();
    }
  }, [hasMore, loadingMore, index, posts.length, pageMark, onNeedMore]);

  useFocusTrap(panelRef);

  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "i") setShowInfo((s) => !s);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [go, onClose]);

  // Describe the tags of the post being viewed — one small request that also
  // teaches the taste profile from posts the user merely looked at.
  useEffect(() => {
    if (post) void ensureTagMeta(post);
  }, [post]);

  // Warm the neighbours so paging through images never shows an empty frame.
  useEffect(() => {
    for (const neighbour of [posts[index + 1], posts[index - 1]]) {
      if (neighbour && !isVideo(neighbour)) {
        const img = new window.Image();
        img.src = neighbour.file_url;
      }
    }
  }, [posts, index]);

  const liked = post ? isLiked(post.id) : false;
  const video = post ? isVideo(post) : false;
  const tagGroups = post
    ? groupTagsByCategory(post.tags.split(/\s+/).filter(Boolean), tagMeta)
    : [];

  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      go(dx < 0 ? 1 : -1);
    } else if (dy > SWIPE_PX * 2 && Math.abs(dy) > Math.abs(dx)) {
      onClose();
    }
  }

  const iconButton =
    "flex size-11 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur transition-colors hover:bg-black/80 disabled:opacity-30 disabled:hover:bg-black/60";

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={post ? `Post ${post.id}` : "Loading post"}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-black outline-none"
      onTouchStart={(e) => {
        touchStart.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
        };
      }}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="truncate text-sm text-neutral-400">
          {post ? `#${post.id}` : "…"}
          <span className="mx-2 text-neutral-700">·</span>
          {Math.min(index + 1, posts.length)}/{posts.length}
          {hasMore && "+"}
        </span>
        <div className="flex items-center gap-2">
          {post && (
            <>
              <button
                onClick={() => setShowInfo((s) => !s)}
                aria-pressed={showInfo}
                aria-label="Post details"
                title="Post details (i)"
                className={iconButton}
              >
                <SlidersIcon className="size-5" />
              </button>
              <a
                href={post.file_url}
                target="_blank"
                rel="noreferrer"
                aria-label="Open original"
                title="Open original"
                className={iconButton}
              >
                <ExternalLinkIcon className="size-5" />
              </a>
            </>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className={iconButton}
          >
            <CloseIcon className="size-5" />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        {!post ? (
          <p className="px-6 text-center text-sm text-neutral-500">
            {beyondLoaded && (hasMore || loadingMore)
              ? "Loading more…"
              : "That's the end of the feed."}
          </p>
        ) : video ? (
          <video
            key={post.id}
            src={post.file_url}
            controls
            autoPlay
            loop
            playsInline
            className="max-h-full max-w-full"
          />
        ) : (
          <>
            {/* The grid-sized sample stands in until the full file has
                decoded, so paging never shows an empty frame — and stays,
                unblurred, when the full file is gone from the CDN. */}
            {!loaded && post.sample_url && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={post.sample_url}
                alt={fileFailed ? `post ${post.id}` : ""}
                aria-hidden={!fileFailed}
                className={`absolute max-h-full max-w-full object-contain ${
                  fileFailed ? "" : "blur-[2px]"
                }`}
              />
            )}
            {fileFailed ? (
              !post.sample_url && (
                <p className="px-6 text-center text-sm text-neutral-500">
                  This file is no longer available.
                </p>
              )
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={post.id}
                src={post.file_url}
                alt={`post ${post.id}`}
                onLoad={() => setLoaded(true)}
                onError={() => setFileFailed(true)}
                className={`max-h-full max-w-full object-contain transition-opacity motion-reduce:transition-none ${
                  loaded ? "opacity-100" : "opacity-0"
                }`}
              />
            )}
          </>
        )}

        <button
          onClick={() => go(-1)}
          disabled={!hasPrev}
          aria-label="Previous post"
          className={`absolute left-2 max-sm:hidden ${iconButton}`}
        >
          <ChevronLeftIcon className="size-6" />
        </button>
        <button
          onClick={() => go(1)}
          disabled={!hasNext}
          aria-label="Next post"
          className={`absolute right-2 max-sm:hidden ${iconButton}`}
        >
          <ChevronRightIcon className="size-6" />
        </button>
      </div>

      {showInfo && post && (
        <div className="max-h-[40vh] overflow-y-auto border-t border-neutral-800 px-4 py-3">
          <p className="mb-2 flex items-center gap-3 text-sm text-neutral-400">
            <span className="flex items-center gap-1">
              <StarIcon className="size-3.5" />
              {post.score}
            </span>
            <span className="capitalize">{post.rating}</span>
            <span>
              {post.width}×{post.height}
            </span>
          </p>
          {tagGroups.map(({ category, tags }) => (
            <div key={category} className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 text-xs tracking-wide text-neutral-500 uppercase">
                {CATEGORY_LABEL[category]}
              </span>
              {tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    onClose();
                    router.push(`/?tags=${encodeURIComponent(tag)}`);
                  }}
                  className={`rounded-full px-3 py-1 text-sm transition-colors ${CATEGORY_STYLE[category]}`}
                >
                  {tag}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-center gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          onClick={() => go(-1)}
          disabled={!hasPrev}
          aria-label="Previous post"
          className={`sm:hidden ${iconButton}`}
        >
          <ChevronLeftIcon className="size-6" />
        </button>
        <button
          onClick={() => post && toggleLike(post)}
          disabled={!post}
          aria-pressed={liked}
          aria-label={liked ? "Unlike" : "Like"}
          className={`flex min-h-11 items-center gap-2 rounded-full px-5 text-sm transition-colors ${
            liked
              ? "bg-rose-500/20 text-rose-300"
              : "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"
          }`}
        >
          <HeartIcon filled={liked} className="size-5" />
          {liked ? "Liked" : "Like"}
        </button>
        {dismissable && post && (
          <button
            onClick={() => {
              dismiss(post);
              // The feed drops a dismissed post at once, so the next post
              // slides into this index by itself — stepping forward too
              // would skip one. At the end of the feed, close instead.
              if (!hasNext) onClose();
            }}
            aria-label="Not interested"
            className="flex min-h-11 items-center gap-2 rounded-full bg-neutral-800 px-5 text-sm text-neutral-200 hover:bg-neutral-700"
          >
            <NotInterestedIcon className="size-5" />
            <span className="max-sm:hidden">Not interested</span>
          </button>
        )}
        <button
          onClick={() => {
            if (!post) return;
            const similar = distinctiveTags(post, 3, tagMeta).join(" ");
            onClose();
            router.push(similar ? `/?tags=${encodeURIComponent(similar)}` : "/");
          }}
          disabled={!post}
          aria-label="More like this"
          className="flex min-h-11 items-center gap-2 rounded-full bg-neutral-800 px-5 text-sm text-neutral-200 hover:bg-neutral-700"
        >
          <SimilarIcon className="size-5" />
          <span className="max-sm:hidden">More like this</span>
        </button>
        <button
          onClick={() => go(1)}
          disabled={!hasNext}
          aria-label="Next post"
          className={`sm:hidden ${iconButton}`}
        >
          <ChevronRightIcon className="size-6" />
        </button>
      </div>
    </div>
  );
}
