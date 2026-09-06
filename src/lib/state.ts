import type { Post } from "@/lib/types";

/**
 * Shape and limits of the persisted app state.
 *
 * Deliberately free of both `"use client"` and any server-only import: the
 * SQLite layer (`db.ts`/`store.ts`) and the browser store (`prefs.ts`) both
 * pull their caps and row types from here, so a limit can never drift
 * between the side that enforces it and the side that displays it.
 */

export const MAX_LIKES = 500;
/** The API rejects very long queries, so the blacklist can't grow forever. */
export const MAX_BLOCKED_TAGS = 25;
export const MAX_DISMISSED = 300;
/** Ring buffer of posts the For You feed has already shown you. */
export const MAX_SEEN = 2000;
/** ~30 bytes an entry; the cap keeps a long-lived install from growing forever. */
export const MAX_TAGS = 8000;

export interface LikedPost {
  id: number;
  tags: string[];
  score: number;
  rating: string;
  likedAt: number;
  /** Full post for rendering in the Liked view; loaded separately, see prefs.ts. */
  post?: Post;
}

/** A post marked "not interested" — kept with its tags as negative signal. */
export interface DismissedPost {
  id: number;
  tags: string[];
  dismissedAt: number;
}

/**
 * What every page needs from the first frame on. The full posts behind the
 * likes and the tag metadata are fetched separately — they are far larger and
 * only two views need them.
 */
export interface AppSnapshot {
  likes: LikedPost[];
  dismissed: DismissedPost[];
  seen: number[];
  seeds: string[];
  blocked: string[];
}

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
