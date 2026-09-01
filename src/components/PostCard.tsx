"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isGif, isVideo, type Post } from "@/lib/types";
import { useDismissed, useLikes } from "@/lib/prefs";
import { distinctiveTags } from "@/lib/recommend";
import { useTagMeta } from "@/lib/tagmeta";
import {
  HeartIcon,
  NotInterestedIcon,
  PlayIcon,
  SimilarIcon,
  StarIcon,
} from "./icons";

interface PostCardProps {
  post: Post;
  /** Opens the lightbox; without it the card links straight to the file. */
  onOpen?: () => void;
  /** Show "not interested" — only feeds that learn from it pass this. */
  dismissable?: boolean;
}

export function PostCard({ post, onOpen, dismissable = false }: PostCardProps) {
  const router = useRouter();
  const { isLiked, toggleLike } = useLikes();
  const tagMeta = useTagMeta();
  const { dismiss } = useDismissed();
  const liked = isLiked(post.id);
  const video = isVideo(post);
  const gif = isGif(post);
  // Preview thumbnails are small; sample_url looks much better in the grid
  // but falls back to file_url for videos, so keep previews there.
  const preferred = video ? post.preview_url : post.sample_url || post.preview_url;
  // CDN files disappear; step down to the preview, then to a placeholder,
  // instead of leaving a broken-image icon in the grid.
  const [failed, setFailed] = useState(0);
  const src = failed === 0 ? preferred : post.preview_url;
  const dead = failed >= 2 || (failed === 1 && preferred === post.preview_url);

  function onCardClick(e: React.MouseEvent) {
    // Keep modified clicks (new tab, download, …) on the plain file link.
    if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOpen();
  }

  function onLike(e: React.MouseEvent) {
    // The whole card is a link; keep button clicks from following it.
    e.preventDefault();
    e.stopPropagation();
    toggleLike(post);
  }

  function onDismiss(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    dismiss(post);
  }

  function onMoreLikeThis(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const tags = distinctiveTags(post, 3, tagMeta).join(" ");
    router.push(tags ? `/?tags=${encodeURIComponent(tags)}` : "/");
  }

  return (
    <a
      href={post.file_url}
      target="_blank"
      rel="noreferrer"
      onClick={onCardClick}
      // Offscreen cards skip rendering entirely; `auto` lets the browser
      // remember each card's real height, so scrolling stays stable while a
      // long feed keeps thousands of cards out of the render path.
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 400px" }}
      className="group relative block overflow-hidden rounded-xl bg-neutral-900"
    >
      {dead ? (
        <div
          className="flex w-full items-center justify-center text-sm text-neutral-600"
          style={{
            aspectRatio: `${post.sample_width || post.width} / ${
              post.sample_height || post.height
            }`,
          }}
        >
          image unavailable
        </div>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt={`post ${post.id}`}
          width={post.sample_width || post.width}
          height={post.sample_height || post.height}
          loading="lazy"
          onError={() => setFailed((f) => f + 1)}
          className="w-full transition-transform duration-200 group-hover:scale-[1.02]"
        />
      )}

      {(video || gif) && (
        <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-white">
          {video ? (
            <span className="flex items-center gap-1">
              <PlayIcon className="size-3" />
              video
            </span>
          ) : (
            "gif"
          )}
        </span>
      )}

      <div
        className={`absolute right-2 top-2 flex gap-1.5 transition-opacity pointer-coarse:opacity-100 ${
          liked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <button
          onClick={onLike}
          aria-pressed={liked}
          aria-label={liked ? "Unlike" : "Like"}
          title={liked ? "Unlike" : "Like"}
          className={`flex size-8 items-center justify-center rounded-md bg-black/70 ${
            liked ? "text-rose-400" : "text-white hover:text-rose-300"
          }`}
        >
          <HeartIcon filled={liked} className="size-5" />
        </button>
        {dismissable && (
          <button
            onClick={onDismiss}
            aria-label="Not interested"
            title="Not interested"
            className="flex size-8 items-center justify-center rounded-md bg-black/70 text-white hover:text-amber-300"
          >
            <NotInterestedIcon className="size-5" />
          </button>
        )}
        <button
          onClick={onMoreLikeThis}
          aria-label="More like this"
          title="More like this"
          className="flex size-8 items-center justify-center rounded-md bg-black/70 text-white hover:text-indigo-300"
        >
          <SimilarIcon className="size-5" />
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 text-xs text-neutral-200 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100">
        <span>#{post.id}</span>
        <span className="flex items-center gap-1">
          <StarIcon className="size-3.5" />
          {post.score}
        </span>
      </div>
    </a>
  );
}
