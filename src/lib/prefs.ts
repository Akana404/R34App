"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  MAX_LIKES,
  sanitizeBlockedTags as sanitizeBlocked,
  tagsOf,
  type AppSnapshot,
  type DismissedPost,
  type LikedPost,
} from "@/lib/state";
import type { Post } from "@/lib/types";
import type { MobileColumns } from "@/components/PostGrid";

export {
  MAX_BLOCKED_TAGS,
  MAX_DISMISSED,
  MAX_LIKES,
  MAX_SEEN,
} from "@/lib/state";
export type { DismissedPost, LikedPost } from "@/lib/state";

/**
 * The app's state, as the browser sees it.
 *
 * Two stores live here. The *content* — likes, dismissals, seen posts, seed
 * and blocked tags — is kept by the server in SQLite; this module holds a
 * mirror of it that is hydrated once per page load and written through on
 * every change, so the hooks stay synchronous and every browser hitting the
 * same server sees the same data. The three per-browser UI switches
 * (mobile column count, hide-AI, rating filter) have no business on a server
 * and stay in `localStorage`.
 */

const COLUMNS_KEY = "mobileColumns";
const HIDE_AI_KEY = "hideAi";
const RATING_KEY = "rating";

/** Query suffix that filters out AI posts when the hide-AI toggle is on. */
export const HIDE_AI_TAGS = "-ai_generated";

export const RATINGS = ["", "safe", "questionable", "explicit"] as const;
export type Rating = (typeof RATINGS)[number];

// ---------------------------------------------------------------------------
// Browser-local UI settings
// ---------------------------------------------------------------------------

function subscribeToStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

function notifyStorage(key: string) {
  // "storage" only fires in other tabs; notify this tab's subscribers too.
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

// Sticky once tripped: a full store stays effectively read-only for the rest
// of the session, and clearing the flag on a later small write would hide that.
let storageFailed = false;

const STORAGE_ERROR_KEY = "__storageError";

/**
 * `localStorage.setItem` that survives a full store or a browser that throws
 * on every write (Safari private mode). Returns whether the write landed.
 */
function trySetItem(key: string, raw: string): boolean {
  try {
    localStorage.setItem(key, raw);
    return true;
  } catch {
    if (!storageFailed) {
      storageFailed = true;
      notifyStorage(STORAGE_ERROR_KEY);
    }
    return false;
  }
}

// getSnapshot must return a referentially stable value or useSyncExternalStore
// re-renders forever, so cache the parsed JSON keyed by the raw string.
const parseCache = new Map<string, { raw: string; parsed: unknown }>();

function readStored<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const cached = parseCache.get(key);
  if (cached && cached.raw === raw) return cached.parsed as T;
  try {
    const parsed = JSON.parse(raw) as T;
    parseCache.set(key, { raw, parsed });
    return parsed;
  } catch {
    return fallback;
  }
}

function useStoredJSON<T>(key: string, fallback: T): [T, (next: T) => void] {
  const value = useSyncExternalStore(
    subscribeToStorage,
    () => readStored(key, fallback),
    () => fallback,
  );
  const setValue = useCallback(
    (next: T) => {
      if (trySetItem(key, JSON.stringify(next))) notifyStorage(key);
    },
    [key],
  );
  return [value, setValue];
}

export function useMobileColumns(): [MobileColumns, () => void] {
  const columns = useSyncExternalStore<MobileColumns>(
    subscribeToStorage,
    () => (localStorage.getItem(COLUMNS_KEY) === "1" ? 1 : 2),
    () => 2,
  );

  const toggle = useCallback(() => {
    if (trySetItem(COLUMNS_KEY, columns === 2 ? "1" : "2"))
      notifyStorage(COLUMNS_KEY);
  }, [columns]);

  return [columns, toggle];
}

export function useHideAi(): [boolean, () => void] {
  const [hideAi, setHideAi] = useStoredJSON<boolean>(HIDE_AI_KEY, false);
  const toggle = useCallback(() => setHideAi(!hideAi), [hideAi, setHideAi]);
  return [hideAi, toggle];
}

export function useRating(): [Rating, (next: Rating) => void] {
  const [rating, setRating] = useStoredJSON<Rating>(RATING_KEY, "");
  const set = useCallback(
    (next: Rating) => setRating(RATINGS.includes(next) ? next : ""),
    [setRating],
  );
  return [rating, set];
}

// ---------------------------------------------------------------------------
// Server-backed content state
// ---------------------------------------------------------------------------

const NO_LIKES: LikedPost[] = [];
const NO_DISMISSED: DismissedPost[] = [];
const NO_TAGS: string[] = [];

type ContentState = Omit<AppSnapshot, "seen">;

let content: ContentState | null = null;
/**
 * Kept apart from `content` because it is read and written outside React —
 * a feed that re-ranked as its own posts became "seen" would reshuffle
 * itself under the reader.
 */
let seenIds: Set<number> | null = null;

const listeners = new Set<() => void>();

function subscribeToContent(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notifyContent() {
  for (const listener of listeners) listener();
}

/**
 * Seeds the mirror from the snapshot the server rendered with. Called during
 * render, so it has to be idempotent: only the first snapshot of a page load
 * wins, and every later change comes from a mutation.
 */
export function hydrateContent(snapshot: AppSnapshot) {
  if (content) return;
  content = {
    likes: snapshot.likes,
    dismissed: snapshot.dismissed,
    seeds: snapshot.seeds,
    blocked: snapshot.blocked,
  };
  seenIds = new Set(snapshot.seen);
}

/**
 * Clears the mirror. Module-level state outlives a single test, so the suite
 * needs a way back to "nothing loaded yet" between cases.
 */
export function resetContent() {
  content = null;
  seenIds = null;
  saveFailed = false;
  storageFailed = false;
  likePosts.clear();
  likePostsLoaded = false;
  likePostsPending = null;
  likePostsVersion++;
  joinCache = null;
  for (const slice of Object.keys(tickets) as Slice[]) tickets[slice] = 0;
}

/** True once a write to the store failed — sticky, like the storage flag. */
let saveFailed = false;

function subscribeToWarnings(callback: () => void) {
  window.addEventListener("storage", callback);
  listeners.add(callback);
  return () => {
    window.removeEventListener("storage", callback);
    listeners.delete(callback);
  };
}

/** True once any change this session could not be saved. */
export function useStorageWarning(): boolean {
  return useSyncExternalStore(
    subscribeToWarnings,
    () => storageFailed || saveFailed,
    () => false,
  );
}

type Mutation =
  | { action: "toggleLike"; post: Post }
  | { action: "dismiss"; post: Post }
  | { action: "undismiss"; id: number }
  | { action: "clearDismissed" }
  | { action: "recordSeen"; ids: number[] }
  | { action: "setSeeds"; tags: string[] }
  | { action: "setBlockedTags"; tags: string[] }
  | { action: "recordTagInfo"; entries: unknown[] };

export async function postMutation<T>(body: Mutation): Promise<T> {
  const res = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`state mutation failed with ${res.status}`);
  return (await res.json()) as T;
}

type Slice = keyof ContentState;

// One ticket counter per slice: a response only gets to write if no newer
// request for that slice has been sent since, or a slow answer would drag the
// view back to a state the user has already moved past.
const tickets: Record<Slice, number> = {
  likes: 0,
  dismissed: 0,
  seeds: 0,
  blocked: 0,
};

function applySlice<K extends Slice>(key: K, value: ContentState[K]) {
  if (!content || content[key] === value) return;
  content = { ...content, [key]: value };
  notifyContent();
}

/**
 * Paints the change immediately, then writes it through. The server answers
 * with the slice it actually stored, which is how a cap eviction the client
 * guessed at gets corrected; a failed write rolls the change back and raises
 * the save warning.
 */
function mutateSlice<K extends Slice>(
  key: K,
  optimistic: ContentState[K],
  body: Mutation,
) {
  if (!content) return;
  const rollback = content[key];
  const ticket = ++tickets[key];
  applySlice(key, optimistic);

  postMutation<ContentState[K]>(body)
    .then((stored) => {
      if (ticket === tickets[key]) applySlice(key, stored);
    })
    .catch(() => {
      if (ticket === tickets[key]) applySlice(key, rollback);
      if (!saveFailed) {
        saveFailed = true;
        notifyContent();
      }
    });
}

/**
 * One id set per stored value, shared by every component that asks.
 *
 * The mirror hands back a referentially stable array — it is only replaced
 * when the slice actually changes — so this WeakMap turns "a Set per card per
 * render" into "a Set per distinct value". With a few hundred cards mounted,
 * each carrying these hooks, rebuilding them per card made every like cost
 * hundreds of thousands of inserts.
 */
const idSetCache = new WeakMap<object, Set<number>>();

function idSetOf(list: { id: number }[]): Set<number> {
  let ids = idSetCache.get(list);
  if (!ids) {
    ids = new Set(list.map((entry) => entry.id));
    idSetCache.set(list, ids);
  }
  return ids;
}

function useSlice<K extends Slice>(
  key: K,
  fallback: ContentState[K],
): ContentState[K] {
  return useSyncExternalStore(
    subscribeToContent,
    () => content?.[key] ?? fallback,
    () => fallback,
  );
}

export function useLikes() {
  const likes = useSlice("likes", NO_LIKES);

  const likedIds = idSetOf(likes);

  const isLiked = useCallback((id: number) => likedIds.has(id), [likedIds]);

  const toggleLike = useCallback((post: Post) => {
    // Read the mirror, not the render closure, so two toggles in quick
    // succession don't clobber each other.
    const current = content?.likes;
    if (!current) return;
    const next = current.some((like) => like.id === post.id)
      ? current.filter((like) => like.id !== post.id)
      : [
          ...current,
          {
            id: post.id,
            tags: tagsOf(post),
            score: post.score,
            rating: post.rating,
            likedAt: Date.now(),
          },
        ].slice(-MAX_LIKES);
    rememberLikePost(post);
    mutateSlice("likes", next, { action: "toggleLike", post });
  }, []);

  return { likes, likedIds, isLiked, toggleLike };
}

// The full posts behind the likes: far heavier than the rest of the state and
// needed by the Liked view alone, so they load separately and stay cached for
// the session. Liking a post seeds its own entry, so it shows up at once.
const likePosts = new Map<number, Post>();
let likePostsLoaded = false;
let likePostsPending: Promise<void> | null = null;
let likePostsVersion = 0;

function rememberLikePost(post: Post) {
  likePosts.set(post.id, post);
  likePostsVersion++;
}

function loadLikePosts(): Promise<void> {
  if (likePostsLoaded) return Promise.resolve();
  likePostsPending ??= fetch("/api/state?part=likePosts")
    .then((res) => {
      if (!res.ok) throw new Error(`liked posts failed with ${res.status}`);
      return res.json() as Promise<Post[]>;
    })
    .then((posts) => {
      for (const post of posts) likePosts.set(post.id, post);
      likePostsLoaded = true;
      likePostsVersion++;
      notifyContent();
    })
    .catch(() => {
      // The Liked view degrades to "nothing to show"; a reload retries.
      likePostsPending = null;
    });
  return likePostsPending;
}

let joinCache: {
  likes: LikedPost[];
  version: number;
  value: LikedPost[];
} | null = null;

function likedWithPosts(): LikedPost[] {
  const likes = content?.likes ?? NO_LIKES;
  if (
    joinCache &&
    joinCache.likes === likes &&
    joinCache.version === likePostsVersion
  ) {
    return joinCache.value;
  }
  const value = likes.map((like) =>
    likePosts.has(like.id) ? { ...like, post: likePosts.get(like.id) } : like,
  );
  joinCache = { likes, version: likePostsVersion, value };
  return value;
}

/** The likes with their posts attached, for the Liked view. */
export function useLikedPosts(): { likes: LikedPost[]; loading: boolean } {
  useEffect(() => {
    void loadLikePosts();
  }, []);

  const likes = useSyncExternalStore(
    subscribeToContent,
    likedWithPosts,
    () => NO_LIKES,
  );
  const loading = useSyncExternalStore(
    subscribeToContent,
    () => !likePostsLoaded,
    () => true,
  );

  return { likes, loading };
}

export function useDismissed() {
  const dismissed = useSlice("dismissed", NO_DISMISSED);

  const dismissedIds = idSetOf(dismissed);

  const dismiss = useCallback((post: Post) => {
    const current = content?.dismissed;
    if (!current || current.some((entry) => entry.id === post.id)) return;
    const next = [
      ...current,
      { id: post.id, tags: tagsOf(post), dismissedAt: Date.now() },
    ];
    mutateSlice("dismissed", next, { action: "dismiss", post });
  }, []);

  const undismiss = useCallback((id: number) => {
    const current = content?.dismissed;
    if (!current) return;
    mutateSlice(
      "dismissed",
      current.filter((entry) => entry.id !== id),
      { action: "undismiss", id },
    );
  }, []);

  const clearDismissed = useCallback(() => {
    mutateSlice("dismissed", NO_DISMISSED, { action: "clearDismissed" });
  }, []);

  return { dismissed, dismissedIds, dismiss, undismiss, clearDismissed };
}

export function useSeedTags() {
  const seeds = useSlice("seeds", NO_TAGS);

  const setSeeds = useCallback((next: string[]) => {
    mutateSlice("seeds", next, { action: "setSeeds", tags: next });
  }, []);

  return { seeds, setSeeds };
}

/** Tags excluded from every search, as `-tag` on the query. */
export function useBlockedTags() {
  const blocked = useSlice("blocked", NO_TAGS);

  const setBlockedTags = useCallback((next: string[]) => {
    // The server applies the same rules again; this only keeps the optimistic
    // paint from showing something it will immediately take back.
    mutateSlice("blocked", sanitizeBlocked(next), {
      action: "setBlockedTags",
      tags: next,
    });
  }, []);

  return { blocked, setBlockedTags };
}

/**
 * Posts the For You feed has shown before. Read outside React on purpose, and
 * handed out as a copy so a feed that snapshots it keeps its ordering stable
 * while the run records more.
 */
export function readSeen(): Set<number> {
  // Called from render (via useMemo), so it also runs while prerendering.
  if (typeof window === "undefined") return new Set();
  return new Set(seenIds);
}

export function recordSeen(ids: number[]) {
  if (typeof window === "undefined" || !seenIds) return;
  const fresh = ids.filter((id) => !seenIds!.has(id));
  if (fresh.length === 0) return;
  for (const id of fresh) seenIds.add(id);
  // Monotonic and advisory: ids are only ever added, so a lost write costs a
  // post its down-ranking and nothing else. Not worth a warning.
  void postMutation({ action: "recordSeen", ids: fresh }).catch(() => {});
}

/**
 * The query suffix for the content filters, shared by every feed: rating,
 * blocked tags and the hide-AI shortcut.
 */
export function contentFilterTags(opts: {
  rating: Rating;
  blocked: string[];
  hideAi: boolean;
}): string {
  return [
    opts.rating ? `rating:${opts.rating}` : "",
    ...opts.blocked.map((tag) => `-${tag}`),
    opts.hideAi ? HIDE_AI_TAGS : "",
  ]
    .filter(Boolean)
    .join(" ");
}
