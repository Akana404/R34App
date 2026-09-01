"use client";

import { useSyncExternalStore } from "react";
import { trySetItem } from "@/lib/prefs";
import type { Post, TagCategory, TagMetaMap, TagInfo } from "@/lib/types";

const TAG_META_KEY = "tagMeta";
/**
 * Roughly how many tags we keep. Each entry is ~30 bytes, and a 500-like
 * profile touches a few thousand distinct tags — well inside the localStorage
 * budget, while the cap keeps a long-lived install from growing forever.
 */
const MAX_TAGS = 8000;

/**
 * Stored compactly as `[tag, count, category]` entries. An array, not an
 * object: eviction relies on insertion order, and object keys that look like
 * integers ("2023") are always enumerated first regardless of when they were
 * inserted — they could never be refreshed and were always evicted first.
 */
type StoredMeta = [string, number, string][];
/** The shape written before the order fix; still readable. */
type LegacyStoredMeta = Record<string, [number, string]>;

/** Accepts both the current and the legacy stored shape, in order. */
function storedEntries(raw: string): [string, [number, string]][] {
  const parsed = JSON.parse(raw) as StoredMeta | LegacyStoredMeta;
  if (Array.isArray(parsed))
    return parsed.map(([tag, count, category]) => [tag, [count, category]]);
  return Object.entries(parsed);
}

const EMPTY: TagMetaMap = new Map();

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

// useSyncExternalStore needs a referentially stable snapshot, so the parsed
// map is cached against the raw string it came from.
let cache: { raw: string; map: TagMetaMap } | null = null;

function readMap(): TagMetaMap {
  const raw = localStorage.getItem(TAG_META_KEY);
  if (raw === null) return EMPTY;
  if (cache && cache.raw === raw) return cache.map;
  try {
    const map: TagMetaMap = new Map(
      storedEntries(raw).map(([tag, [count, category]]) => [
        tag,
        { count, category: category as TagCategory },
      ]),
    );
    cache = { raw, map };
    return map;
  } catch {
    return EMPTY;
  }
}

/** Reads the store outside React, for background work that shouldn't
 * re-subscribe on every write. */
export function readTagMeta(): TagMetaMap {
  return readMap();
}

/** The learned tag metadata; empty until a liked post has been looked up. */
export function useTagMeta(): TagMetaMap {
  return useSyncExternalStore(subscribe, readMap, () => EMPTY);
}

/**
 * Merges freshly fetched `tag_info` into the store. Newly written tags stay
 * at the end of the insertion order, so trimming drops the least recently
 * seen ones first.
 */
export function recordTagInfo(entries: TagInfo[]) {
  // A Map keeps true insertion order (unlike object keys, which reorder
  // integer-like tags such as "2023"), so eviction really drops the least
  // recently seen tags.
  let map = new Map<string, [number, string]>();
  try {
    map = new Map(storedEntries(localStorage.getItem(TAG_META_KEY) ?? "[]"));
  } catch {
    map = new Map();
  }
  for (const { tag, count, type } of entries) {
    map.delete(tag);
    map.set(tag, [count, type]);
  }
  while (map.size > MAX_TAGS) map.delete(map.keys().next().value!);
  const serialize = () =>
    JSON.stringify(
      [...map].map(([tag, [count, category]]) => [tag, count, category]),
    );
  if (!trySetItem(TAG_META_KEY, serialize())) {
    // Out of space: this is only a cache, so evict the older half and try
    // once more rather than losing the feature (or throwing) outright.
    for (const key of [...map.keys()].slice(0, Math.floor(map.size / 2)))
      map.delete(key);
    if (!trySetItem(TAG_META_KEY, serialize())) return;
  }
  // "storage" only fires in other tabs; notify this tab's subscribers too.
  window.dispatchEvent(new StorageEvent("storage", { key: TAG_META_KEY }));
}

/**
 * Looks a single post up with `fields=tag_info` and stores what comes back.
 * Resolves false when the post genuinely has no tag info (permanent);
 * throws on a failed request (transient — a 429, a flaky network), so
 * callers can tell "don't bother again" from "try again later".
 */
export async function fetchTagMetaForPost(id: number): Promise<boolean> {
  const res = await fetch(
    `/api/posts?tags=${encodeURIComponent(`id:${id}`)}&page=0&limit=1&tagInfo=1`,
  );
  if (!res.ok) throw new Error(`tag lookup failed (${res.status})`);
  const posts = (await res.json()) as { tag_info?: TagInfo[] }[];
  const info = posts[0]?.tag_info;
  if (!info?.length) return false;
  recordTagInfo(info);
  return true;
}

/** Posts looked up this session, so opening one twice costs one request. */
const requested = new Set<number>();
/** A post is covered once this share of its tags is known. */
const COVERAGE = 0.9;

/**
 * Makes sure the tags of a post the user is *looking at* are described.
 *
 * Cheap on its own (one small request), and it feeds the same store the taste
 * profile reads, so browsing teaches the recommender as well as colouring the
 * tag list.
 */
export async function ensureTagMeta(post: Post): Promise<void> {
  if (requested.has(post.id)) return;
  const tags = post.tags.split(/\s+/).filter(Boolean);
  if (tags.length === 0) return;
  const meta = readTagMeta();
  const known = tags.filter((tag) => meta.has(tag)).length;
  if (known / tags.length >= COVERAGE) return;
  requested.add(post.id);
  try {
    await fetchTagMetaForPost(post.id);
  } catch {
    // A failed lookup just means uncoloured tags; not worth surfacing —
    // but transient, so opening the post again may retry.
    requested.delete(post.id);
  }
}

/** Order tags are shown in: who made it and what it is, before the details. */
const CATEGORY_ORDER: TagCategory[] = [
  "artist",
  "character",
  "copyright",
  "tag",
  "metadata",
];

export interface TagGroup {
  category: TagCategory;
  tags: string[];
}

/**
 * Groups a post's tags by category, most identifying first. Tags with no
 * metadata yet fall in with the general ones, so nothing disappears.
 */
export function groupTagsByCategory(
  tags: string[],
  meta: TagMetaMap,
): TagGroup[] {
  const byCategory = new Map<TagCategory, string[]>();
  for (const tag of tags) {
    const category = meta.get(tag)?.category ?? "tag";
    const known = CATEGORY_ORDER.includes(category) ? category : "tag";
    const list = byCategory.get(known);
    if (list) list.push(tag);
    else byCategory.set(known, [tag]);
  }
  return CATEGORY_ORDER.filter((category) => byCategory.has(category)).map(
    (category) => ({ category, tags: byCategory.get(category)! }),
  );
}
