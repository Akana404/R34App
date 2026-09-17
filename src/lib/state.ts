import type { Post } from "@/lib/types";

/**
 * Shape and limits of the persisted app state.
 *
 * Deliberately free of both `"use client"` and any server-only import: the
 * SQLite layer (`db.ts`/`store.ts`) and the browser store (`prefs.ts`) both
 * pull their caps and row types from here, so a limit can never drift
 * between the side that enforces it and the side that displays it.
 *
 * Two shapes per stored post, and the split is what keeps a page load small:
 * a *ref* (id plus its timestamp) is all a card needs to fill its heart, and
 * refs are what every page is hydrated with. The tags behind a like are ten
 * times as heavy and only the taste profile reads them, so they load on the
 * two pages that build one.
 */

/**
 * Storage is a SQLite file, so these caps are no longer about fitting into a
 * browser quota. What they bound now is the work of a page: likes are shipped
 * as refs on every page (~40 bytes each) and their posts are fetched whole by
 * the Liked view (~1KB each).
 */
export const MAX_LIKES = 2000;
/** The API rejects very long queries, so the blacklist can't grow forever. */
export const MAX_BLOCKED_TAGS = 25;
export const MAX_DISMISSED = 1000;
/** Ring buffer of posts the For You feed has already shown you. */
export const MAX_SEEN = 2000;
/** ~30 bytes an entry; the cap keeps a long-lived install from growing forever. */
export const MAX_TAGS = 8000;

/**
 * How many of the newest likes and dismissals the taste profile is built
 * from. The weights are recency-decayed anyway, so older entries barely move
 * the result — but their tags would still have to be sent.
 */
export const TASTE_WINDOW = 500;

/** A like as every page sees it: enough to know what is liked, and when. */
export interface LikeRef {
  id: number;
  likedAt: number;
}

export interface DismissRef {
  id: number;
  dismissedAt: number;
}

/** A like with the tags the taste profile learns from. */
export interface LikedPost extends LikeRef {
  tags: string[];
  score: number;
  rating: string;
  /** Full post for rendering in the Liked view; loaded separately, see prefs.ts. */
  post?: Post;
}

/** A post marked "not interested" — kept with its tags as negative signal. */
export interface DismissedPost extends DismissRef {
  tags: string[];
}

/**
 * What every page needs from the first frame on: refs only. Tags, the full
 * posts behind the likes and the tag metadata are all fetched separately, by
 * the views that actually need them.
 */
export interface AppSnapshot {
  likes: LikeRef[];
  dismissed: DismissRef[];
  seeds: string[];
  blocked: string[];
}

/**
 * Everything the For You feed needs and no other page does: the tags behind
 * the newest likes and dismissals, plus the ids it has already shown.
 */
export interface TasteProfile {
  likes: LikedPost[];
  dismissed: DismissedPost[];
  seen: number[];
}

/** Everything a backup carries: the same state, with every tag and post. */
export interface StoreContent {
  likes: LikedPost[];
  dismissed: DismissedPost[];
  seeds: string[];
  blocked: string[];
}

/** A tag's site-wide post count and category, as stored and as sent. */
export type TagMetaEntry = [tag: string, count: number, category: string];

export function tagsOf(post: Post): string[] {
  return post.tags.split(/\s+/).filter(Boolean);
}

/**
 * Metatags would silently change what a query means rather than subtract from
 * it, and the list has to stay short enough to send. Enforced where the tags
 * are stored, not where they are typed.
 */
export function sanitizeBlockedTags(next: string[]): string[] {
  const clean = next
    .map((tag) => tag.trim().replace(/^-/, ""))
    .filter((tag) => tag.length > 0 && !tag.includes(":"));
  return [...new Set(clean)].slice(0, MAX_BLOCKED_TAGS);
}
