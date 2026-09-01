"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { Post } from "@/lib/types";
import type { MobileColumns } from "@/components/PostGrid";

const COLUMNS_KEY = "mobileColumns";
const SEEDS_KEY = "forYou:seeds";
const LIKES_KEY = "forYou:likes";
const HIDE_AI_KEY = "hideAi";
const DISMISSED_KEY = "forYou:dismissed";
const BLOCKED_KEY = "blockedTags";
const RATING_KEY = "rating";
const SEEN_KEY = "forYou:seen";
export const MAX_LIKES = 500;
/** The API rejects very long queries, so the blacklist can't grow forever. */
export const MAX_BLOCKED_TAGS = 25;
export const MAX_DISMISSED = 300;
/** Ring buffer of posts the For You feed has already shown you. */
export const MAX_SEEN = 2000;

/** Query suffix that filters out AI posts when the hide-AI toggle is on. */
export const HIDE_AI_TAGS = "-ai_generated";

export const RATINGS = ["", "safe", "questionable", "explicit"] as const;
export type Rating = (typeof RATINGS)[number];

export interface LikedPost {
  id: number;
  tags: string[];
  score: number;
  rating: string;
  likedAt: number;
  /** Full post for rendering in the Liked view; absent on older likes. */
  post?: Post;
}

/** A post marked "not interested" — kept with its tags as negative signal. */
export interface DismissedPost {
  id: number;
  tags: string[];
  dismissedAt: number;
}

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

/**
 * `localStorage.setItem` that survives a full store or a browser that throws
 * on every write (Safari private mode). Returns whether the write landed;
 * the first failure raises the flag behind `useStorageWarning`.
 */
export function trySetItem(key: string, raw: string): boolean {
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

const STORAGE_ERROR_KEY = "__storageError";

/** True once any localStorage write has failed this session. */
export function useStorageWarning(): boolean {
  return useSyncExternalStore(
    subscribeToStorage,
    () => storageFailed,
    () => false,
  );
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

/**
 * One id set per stored value, shared by every component that asks.
 *
 * `readStored` hands back a referentially stable array (see the parse cache
 * above), so this WeakMap turns "a Set per card per render" into "a Set per
 * distinct stored value" — with a few hundred cards mounted, each carrying
 * these hooks, rebuilding them per card made every like cost hundreds of
 * thousands of inserts.
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

function writeStored<T>(key: string, value: T) {
  if (trySetItem(key, JSON.stringify(value))) notifyStorage(key);
}

function useStoredJSON<T>(key: string, fallback: T): [T, (next: T) => void] {
  const value = useSyncExternalStore(
    subscribeToStorage,
    () => readStored(key, fallback),
    () => fallback,
  );
  const setValue = useCallback((next: T) => writeStored(key, next), [key]);
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

const NO_SEEDS: string[] = [];

export function useSeedTags() {
  const [seeds, setSeeds] = useStoredJSON<string[]>(SEEDS_KEY, NO_SEEDS);
  return { seeds, setSeeds };
}

const NO_LIKES: LikedPost[] = [];

export function useLikes() {
  const [likes, setLikes] = useStoredJSON<LikedPost[]>(LIKES_KEY, NO_LIKES);

  const likedIds = idSetOf(likes);

  const isLiked = useCallback((id: number) => likedIds.has(id), [likedIds]);

  const toggleLike = useCallback(
    (post: Post) => {
      // Read fresh so two toggles in quick succession don't clobber each other.
      const current = readStored<LikedPost[]>(LIKES_KEY, NO_LIKES);
      const next = current.some((l) => l.id === post.id)
        ? current.filter((l) => l.id !== post.id)
        : [
            ...current,
            {
              id: post.id,
              tags: post.tags.split(/\s+/).filter(Boolean),
              score: post.score,
              rating: post.rating,
              likedAt: Date.now(),
              post,
            },
          ].slice(-MAX_LIKES);
      setLikes(next);
    },
    [setLikes],
  );

  return { likes, likedIds, isLiked, toggleLike };
}

/** Everything this app persists — the unit of export/import. */
export interface PrefsSnapshot {
  blocked: string[];
  rating: Rating;
  dismissed: DismissedPost[];
  seen: number[];
  likes: LikedPost[];
  seeds: string[];
  hideAi: boolean;
  mobileColumns: MobileColumns;
}

/** Reads the whole store; browser-only, so call it from an event handler. */
export function readPrefsSnapshot(): PrefsSnapshot {
  return {
    likes: readStored<LikedPost[]>(LIKES_KEY, NO_LIKES),
    dismissed: readStored<DismissedPost[]>(DISMISSED_KEY, NO_DISMISSED),
    seen: readStored<number[]>(SEEN_KEY, NO_SEEN),
    seeds: readStored<string[]>(SEEDS_KEY, NO_SEEDS),
    blocked: readStored<string[]>(BLOCKED_KEY, NO_BLOCKED),
    rating: readStored<Rating>(RATING_KEY, ""),
    hideAi: readStored<boolean>(HIDE_AI_KEY, false),
    mobileColumns: localStorage.getItem(COLUMNS_KEY) === "1" ? 1 : 2,
  };
}

/**
 * Writes a snapshot back; every `useSyncExternalStore` hook re-renders.
 *
 * All-or-nothing: a quota failure part-way through rolls the written keys
 * back, so an import can never leave the store half-replaced. Returns
 * whether the snapshot landed.
 */
export function writePrefsSnapshot(next: PrefsSnapshot): boolean {
  const writes: [string, string][] = [
    [LIKES_KEY, JSON.stringify(next.likes.slice(-MAX_LIKES))],
    [DISMISSED_KEY, JSON.stringify(next.dismissed.slice(-MAX_DISMISSED))],
    [SEEN_KEY, JSON.stringify(next.seen.slice(-MAX_SEEN))],
    [SEEDS_KEY, JSON.stringify(next.seeds)],
    [BLOCKED_KEY, JSON.stringify(next.blocked.slice(0, MAX_BLOCKED_TAGS))],
    [RATING_KEY, JSON.stringify(next.rating)],
    [HIDE_AI_KEY, JSON.stringify(next.hideAi)],
    [COLUMNS_KEY, String(next.mobileColumns)],
  ];
  const previous = writes.map(
    ([key]) => [key, localStorage.getItem(key)] as const,
  );
  for (let i = 0; i < writes.length; i++) {
    if (!trySetItem(writes[i][0], writes[i][1])) {
      for (const [key, raw] of previous.slice(0, i)) {
        // The old values fit before, so restoring them normally succeeds —
        // and if even that throws, the key keeps the new value, which is
        // still a valid store.
        if (raw === null) localStorage.removeItem(key);
        else trySetItem(key, raw);
      }
      return false;
    }
  }
  for (const [key] of writes) notifyStorage(key);
  return true;
}

const NO_DISMISSED: DismissedPost[] = [];

export function useDismissed() {
  const [dismissed, setDismissed] = useStoredJSON<DismissedPost[]>(
    DISMISSED_KEY,
    NO_DISMISSED,
  );

  const dismissedIds = idSetOf(dismissed);

  const dismiss = useCallback(
    (post: Post) => {
      // Read fresh, like toggleLike: two dismissals in a row must not race.
      const current = readStored<DismissedPost[]>(DISMISSED_KEY, NO_DISMISSED);
      if (current.some((d) => d.id === post.id)) return;
      setDismissed(
        [
          ...current,
          {
            id: post.id,
            tags: post.tags.split(/\s+/).filter(Boolean),
            dismissedAt: Date.now(),
          },
        ].slice(-MAX_DISMISSED),
      );
    },
    [setDismissed],
  );

  const undismiss = useCallback(
    (id: number) => {
      const current = readStored<DismissedPost[]>(DISMISSED_KEY, NO_DISMISSED);
      setDismissed(current.filter((d) => d.id !== id));
    },
    [setDismissed],
  );

  const clearDismissed = useCallback(
    () => setDismissed(NO_DISMISSED),
    [setDismissed],
  );

  return { dismissed, dismissedIds, dismiss, undismiss, clearDismissed };
}

const NO_SEEN: number[] = [];

/**
 * Posts the For You feed has shown before. Read outside React on purpose:
 * a feed that re-ranked as its own posts became "seen" would reshuffle
 * itself under the reader.
 */
export function readSeen(): Set<number> {
  // Called from render (via useMemo), so it also runs while prerendering.
  if (typeof window === "undefined") return new Set();
  return new Set(readStored<number[]>(SEEN_KEY, NO_SEEN));
}

export function recordSeen(ids: number[]) {
  if (typeof window === "undefined") return;
  const current = readStored<number[]>(SEEN_KEY, NO_SEEN);
  const known = new Set(current);
  const fresh = ids.filter((id) => !known.has(id));
  if (fresh.length === 0) return;
  writeStored(SEEN_KEY, [...current, ...fresh].slice(-MAX_SEEN));
}

const NO_BLOCKED: string[] = [];

/** Tags excluded from every search, as `-tag` on the query. */
export function useBlockedTags() {
  const [blocked, setBlocked] = useStoredJSON<string[]>(
    BLOCKED_KEY,
    NO_BLOCKED,
  );

  const setBlockedTags = useCallback(
    (next: string[]) => {
      // Metatags would silently change what a query means rather than
      // subtract from it, and the list has to stay short enough to send.
      const clean = next
        .map((tag) => tag.trim().replace(/^-/, ""))
        .filter((tag) => tag.length > 0 && !tag.includes(":"));
      setBlocked([...new Set(clean)].slice(0, MAX_BLOCKED_TAGS));
    },
    [setBlocked],
  );

  return { blocked, setBlockedTags };
}

export function useRating(): [Rating, (next: Rating) => void] {
  const [rating, setRating] = useStoredJSON<Rating>(RATING_KEY, "");
  const set = useCallback(
    (next: Rating) => setRating(RATINGS.includes(next) ? next : ""),
    [setRating],
  );
  return [rating, set];
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
