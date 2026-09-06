"use client";

import { useEffect, useSyncExternalStore } from "react";
import { postMutation } from "@/lib/prefs";
import type { Post, TagCategory, TagMetaMap, TagInfo } from "@/lib/types";

/**
 * Tag metadata — each tag's site-wide count and category.
 *
 * A cache, and treated like one: it lives in the same SQLite store as
 * everything else, but a failed read or write costs uncoloured tags and a
 * slightly blunter taste profile, never an error in front of the user. The
 * whole set is fetched once per page load, kept in memory, and written
 * through as posts are looked up; the LRU cap is the server's business.
 */

/** Stored compactly as `[tag, count, category]`, the shape the API returns. */
type TagMetaEntry = [tag: string, count: number, category: string];

const EMPTY: TagMetaMap = new Map();

let meta: TagMetaMap | null = null;
const listeners = new Set<() => void>();

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

let loaded = false;
let pending: Promise<void> | null = null;

/** Drops the cache, so a test starts from "nothing read in yet". */
export function resetTagMeta() {
  meta = null;
  loaded = false;
  pending = null;
  requested.clear();
}

function entriesToMap(entries: TagMetaEntry[]): TagMetaMap {
  return new Map(
    entries.map(([tag, count, category]) => [
      tag,
      { count, category: category as TagCategory },
    ]),
  );
}

/** Pulls the cache in once per page load; a failure just leaves it empty. */
export function loadTagMeta(): Promise<void> {
  if (loaded) return Promise.resolve();
  pending ??= fetch("/api/state?part=tagMeta")
    .then((res) => {
      if (!res.ok) throw new Error(`tag metadata failed with ${res.status}`);
      return res.json() as Promise<TagMetaEntry[]>;
    })
    .then((entries) => {
      // Anything learned while the request was in flight wins: it is newer.
      const fetched = entriesToMap(entries);
      for (const [tag, value] of meta ?? []) fetched.set(tag, value);
      meta = fetched;
      loaded = true;
      notify();
    })
    .catch(() => {
      pending = null;
    });
  return pending;
}

/** Loads the cache once, for a component that is going to read it. */
export function useTagMetaLoader() {
  useEffect(() => {
    void loadTagMeta();
  }, []);
}

/** Reads the store outside React, for background work that shouldn't
 * re-subscribe on every write. */
export function readTagMeta(): TagMetaMap {
  return meta ?? EMPTY;
}

/** The learned tag metadata; empty until the cache has been read in. */
export function useTagMeta(): TagMetaMap {
  return useSyncExternalStore(subscribe, readTagMeta, () => EMPTY);
}

/**
 * Merges freshly fetched `tag_info` into the store and writes it through.
 *
 * The local merge happens first and unconditionally: `TagMetaSync` reads its
 * own writes to decide which post to look up next, so it must not have to
 * wait on a round trip to see them.
 */
export function recordTagInfo(entries: TagInfo[]) {
  if (entries.length === 0) return;
  const next = new Map(meta ?? EMPTY);
  for (const { tag, count, type } of entries) {
    next.set(tag, { count, category: type as TagCategory });
  }
  meta = next;
  notify();
  void postMutation({ action: "recordTagInfo", entries }).catch(() => {});
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
  const known = tags.filter((tag) => readTagMeta().has(tag)).length;
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
