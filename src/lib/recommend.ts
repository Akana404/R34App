import { PAGE_SIZE, type Post, type TagMeta, type TagMetaMap } from "@/lib/types";
import type { DismissedPost, LikedPost } from "@/lib/prefs";

// Ultra-common tags that appear on a large share of all posts and therefore
// carry no signal about personal taste. No tag-category metadata is available
// from the API, so a hardcoded stoplist is the pragmatic filter.
export const TAG_STOPLIST = new Set([
  "female",
  "male",
  "1girls",
  "1girl",
  "1boy",
  "2girls",
  "solo",
  "duo",
  "hetero",
  "straight",
  "male/female",
  "breasts",
  "big_breasts",
  "large_breasts",
  "huge_breasts",
  "nipples",
  "erect_nipples",
  "areolae",
  "nude",
  "penis",
  "pussy",
  "vagina",
  "ass",
  "big_ass",
  "navel",
  "thick_thighs",
  "cum",
  "sex",
  "vaginal_penetration",
  "anal",
  "oral",
  "smile",
  "open_mouth",
  "blush",
  "looking_at_viewer",
  "long_hair",
  "short_hair",
  "hi_res",
  "highres",
  "high_resolution",
  "tagme",
  "censored",
  "uncensored",
  "animated",
  "video",
  "sound",
  "mp4",
  "webm",
  "gif",
]);

// Order of magnitude of the site's post count — only the scale matters, since
// it shifts every rarity by the same constant.
const TOTAL_POSTS = 12_000_000;
/** A tag on this many posts says nothing about one person's taste. */
const GENERIC_COUNT = 2_000_000;
/** Technical tags (3d, animated, watermark…) go generic much earlier. */
const GENERIC_METADATA_COUNT = 200_000;

// Who drew it, who is in it and what it is from identify taste far better
// than another body-part tag, so their weight is nudged up.
const CATEGORY_BOOST: Record<string, number> = {
  artist: 1.4,
  character: 1.3,
  copyright: 1.15,
  tag: 1,
  metadata: 0.4,
};

const META_TAG =
  /^-?(rating|score|sort|user|md5|parent|id|width|height|aspectratio|aspectratiof|sourcedomains):/;

export function isMetaTag(tag: string): boolean {
  return META_TAG.test(tag);
}

/**
 * How much a tag distinguishes taste: rare tags count for more than common
 * ones (inverse document frequency), scaled by how identifying its category
 * is. Unknown tags stay neutral at 1, so a profile works before any metadata
 * has been fetched.
 */
export function tagFactor(tag: string, meta?: TagMetaMap): number {
  const info = meta?.get(tag);
  if (!info) return 1;
  const rarity = Math.log10(TOTAL_POSTS / Math.max(info.count, 1)) / 3;
  const clamped = Math.min(2, Math.max(0.3, rarity));
  return clamped * (CATEGORY_BOOST[info.category] ?? 1);
}

/**
 * Tags that carry no personal signal. With `tag_info` from the API this is a
 * measurement — how many posts site-wide carry the tag, and whether it is
 * technical metadata — and the hardcoded stoplist is only the fallback for
 * tags whose metadata hasn't been fetched yet.
 */
export function isGenericTag(tag: string, meta?: TagMetaMap): boolean {
  if (isMetaTag(tag) || TAG_STOPLIST.has(tag)) return true;
  const info: TagMeta | undefined = meta?.get(tag);
  if (!info) return false;
  if (info.category === "metadata") return info.count > GENERIC_METADATA_COUNT;
  return info.count > GENERIC_COUNT;
}

export interface TagWeight {
  tag: string;
  weight: number;
}

/** A like counts half as much once it is this old. */
const HALF_LIFE_DAYS = 45;
/** …but never less than this, so older taste still colours the profile. */
const MIN_RECENCY = 0.15;

const DAY_MS = 86_400_000;

/** How much a like still counts today, given when it was made. */
export function recencyWeight(likedAt: number, now: number): number {
  const days = Math.max(0, (now - likedAt) / DAY_MS);
  return Math.max(MIN_RECENCY, Math.pow(0.5, days / HALF_LIFE_DAYS));
}

/**
 * The scoring profile: every tag you have liked, weighted by how recently you
 * liked it and by how distinguishing the tag is (see `tagFactor`).
 *
 * Deliberately unpruned — a tag on nearly all of your likes *is* your taste,
 * even though it makes a poor search direction. That distinction lives in
 * `computeDirectionWeights`.
 */
export function computeTagWeights(
  likes: LikedPost[],
  meta?: TagMetaMap,
  now: number = Date.now(),
): Map<string, number> {
  const weights = new Map<string, number>();
  for (const like of likes) {
    const recency = recencyWeight(like.likedAt, now);
    for (const tag of new Set(like.tags)) {
      if (isGenericTag(tag, meta)) continue;
      weights.set(tag, (weights.get(tag) ?? 0) + recency);
    }
  }
  if (meta && meta.size > 0) {
    for (const [tag, weight] of weights) {
      weights.set(tag, weight * tagFactor(tag, meta));
    }
  }
  return weights;
}

/**
 * How much a "not interested" counts against a tag, relative to a like.
 * Below 1 on purpose: dismissing a post says less about every tag it
 * carries than liking one does, and a shared character or artist tag
 * shouldn't be cancelled out by a single bad post.
 */
const DISMISS_FACTOR = 0.7;

/**
 * Folds dismissals into the scoring profile. Tags you only ever dismissed
 * end up negative, so posts carrying them rank below everything else and
 * fall through the relevance gate.
 */
export function applyDismissals(
  profile: Map<string, number>,
  dismissed: DismissedPost[],
  meta?: TagMetaMap,
  now: number = Date.now(),
): Map<string, number> {
  if (dismissed.length === 0) return profile;
  const penalties = computeTagWeights(
    dismissed.map((d) => ({
      id: d.id,
      tags: d.tags,
      score: 0,
      rating: "",
      likedAt: d.dismissedAt,
    })),
    meta,
    now,
  );
  const combined = new Map(profile);
  for (const [tag, penalty] of penalties) {
    combined.set(tag, (combined.get(tag) ?? 0) - penalty * DISMISS_FACTOR);
  }
  return combined;
}

/**
 * The pool of tags worth *searching* for. Unlike the scoring profile this is
 * pruned: a tag seen once is noise to query on, and a tag on nearly every
 * like narrows nothing — both judgements are about raw counts, so recency
 * decay stays out of it.
 */
export function computeDirectionWeights(
  likes: LikedPost[],
  meta?: TagMetaMap,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const like of likes) {
    for (const tag of new Set(like.tags)) {
      if (isGenericTag(tag, meta)) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  if (likes.length >= 5) {
    for (const [tag, count] of counts) {
      if (count === 1 || count > likes.length * 0.8) counts.delete(tag);
    }
  }
  if (!meta || meta.size === 0) return counts;
  // Scale after pruning: the thresholds are about how often *you* liked a
  // tag, which the rarity factor would distort.
  const weighted = new Map<string, number>();
  for (const [tag, count] of counts) {
    weighted.set(tag, count * tagFactor(tag, meta));
  }
  return weighted;
}

export function topWeightedTags(
  weights: Map<string, number>,
  n = 20,
): TagWeight[] {
  return [...weights.entries()]
    .sort(([ta, wa], [tb, wb]) => wb - wa || (ta < tb ? -1 : 1))
    .slice(0, n)
    .map(([tag, weight]) => ({ tag, weight }));
}

// How many of a liked post's strongest tags pair up with each other.
const PAIR_TAGS_PER_LIKE = 4;
// Pool sizes: enough variety to rotate through, small enough to stay on-taste.
const MAX_PAIRS = 30;

/**
 * Weighted tag pairs that co-occurred in liked posts. An AND-query built from
 * such a pair returns posts resembling an actual liked post, unlike two
 * independently sampled tags that may never appear together.
 */
export function computeTagPairs(
  likes: LikedPost[],
  weights: Map<string, number>,
): TagWeight[] {
  const counts = new Map<string, number>();
  for (const like of likes) {
    const tags = [...new Set(like.tags)]
      .filter((t) => weights.has(t))
      .sort((a, b) => weights.get(b)! - weights.get(a)! || (a < b ? -1 : 1))
      .slice(0, PAIR_TAGS_PER_LIKE);
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = [tags[i], tags[j]].sort().join(" ");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return topWeightedTags(counts, MAX_PAIRS);
}

/**
 * How strongly a post matches the taste profile: sum of profile weights over
 * the post's tags. Generic tags never enter the profile, so they don't count.
 */
export function scorePost(post: Post, profile: Map<string, number>): number {
  let score = 0;
  for (const tag of new Set(post.tags.split(/\s+/))) {
    score += profile.get(tag) ?? 0;
  }
  return score;
}

/**
 * Ordering score. `scorePost` sums raw weights, which favours posts that
 * simply carry many tags — posts here range from ~10 to ~100 tags. Dividing
 * by the square root of the tag count damps that without flattening the
 * signal entirely, the way cosine-style length normalisation does.
 */
export function rankScore(post: Post, profile: Map<string, number>): number {
  const tags = new Set(post.tags.split(/\s+/).filter(Boolean));
  if (tags.size === 0) return 0;
  return scorePost(post, profile) / Math.sqrt(tags.size);
}

/** Tiny seeded PRNG so the same feed page always builds the same query. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ForYouQuery {
  tags: string;
  pid: number;
  limit?: number;
}

// Sub-queries (taste directions) fetched and interleaved per feed page.
const DIRECTIONS_PER_PAGE = 3;
/**
 * Single tags stay in the pool next to pairs, at a discount: a pair lands
 * closer to an actual liked post, but a single tag reaches material no pair
 * of your existing tags ever will.
 */
const SINGLE_TAG_DISCOUNT = 0.6;
/** How deep into a direction's results a page may reach. */
const MAX_PID = 20;
/** A direction this niche can't afford a score floor at all. */
const NICHE_COUNT = 2_000;
/** …and one this small only a reduced floor. */
const SMALL_COUNT = 20_000;

/** Upper bound on how many posts a direction can match: its rarest tag. */
function directionSize(direction: string, meta?: TagMetaMap): number | undefined {
  if (!meta || meta.size === 0) return undefined;
  let smallest: number | undefined;
  for (const tag of direction.split(" ")) {
    const info = meta.get(tag);
    if (!info) continue;
    if (smallest === undefined || info.count < smallest) smallest = info.count;
  }
  return smallest;
}

/**
 * A niche direction can have fewer results than the score floor allows
 * through, and would come back empty. Lower the bar the narrower it gets.
 */
function scoreFloorFor(size: number | undefined, minScore: number): number {
  if (size === undefined) return minScore;
  if (size < NICHE_COUNT) return 0;
  if (size < SMALL_COUNT) return Math.floor(minScore / 2);
  return minScore;
}

/**
 * Build the sub-queries for one infinite-scroll page of the For You feed.
 *
 * Each page samples a few "directions" — co-occurring tag pairs from liked
 * posts, or explicit seeds — and fetches them as separate AND-queries that
 * PostGrid interleaves. Pairs keep every direction close to an actual liked
 * post; several directions per page keep a page from leaning into one niche.
 * `sort:random` is unseeded upstream and repeats across pids, so variety
 * comes from rotating the sampled directions per page (PostGrid's id-dedupe
 * absorbs the overlap between pages).
 */
export function buildForYouQueries(opts: {
  seeds: string[];
  likedTop: TagWeight[];
  pairs: TagWeight[];
  page: number;
  shuffleSeed: number;
  minScore?: number;
  meta?: TagMetaMap;
}): ForYouQuery[] {
  const {
    seeds,
    likedTop,
    pairs,
    page,
    shuffleSeed,
    minScore = 10,
    meta,
  } = opts;

  // Metatag seeds (e.g. rating:safe, -rating:explicit) aren't directions;
  // apply them as fixed filters on every sub-query instead.
  const filterSeeds = seeds.filter(isMetaTag);
  const poolSeeds = seeds.filter((s) => !isMetaTag(s));

  const pool = new Map<string, number>();
  for (const { tag, weight } of pairs) pool.set(tag, weight);
  // Single learned tags always compete too, discounted once there are enough
  // pairs to choose from — they broaden a feed that pairs alone keep narrow.
  const discount =
    pairs.length >= DIRECTIONS_PER_PAGE ? SINGLE_TAG_DISCOUNT : 1;
  for (const { tag, weight } of likedTop) {
    if (!pool.has(tag)) pool.set(tag, weight * discount);
  }
  // Explicit seeds always compete at the top weight, even with many likes.
  const seedWeight = Math.max(2, ...likedTop.map((t) => t.weight));
  for (const seed of poolSeeds) pool.set(seed, seedWeight);

  if (pool.size === 0) return [];

  const rng = mulberry32(shuffleSeed ^ Math.imul(page + 1, 2654435761));

  // Weighted sample without replacement.
  const entries = [...pool.entries()];
  const k = Math.min(DIRECTIONS_PER_PAGE, entries.length);
  const picked: string[] = [];
  for (let i = 0; i < k; i++) {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let r = rng() * total;
    let index = entries.length - 1;
    for (let j = 0; j < entries.length; j++) {
      r -= entries[j][1];
      if (r <= 0) {
        index = j;
        break;
      }
    }
    const direction = entries[index][0];
    picked.push(direction);
    // Drop overlapping directions: querying "a" and "a b" on the same page
    // spends two of three slots on nested result sets.
    const tokens = new Set(direction.split(" "));
    for (let j = entries.length - 1; j >= 0; j--) {
      const other = entries[j][0].split(" ");
      const nested =
        other.every((t) => tokens.has(t)) ||
        [...tokens].every((t) => other.includes(t));
      if (nested) entries.splice(j, 1);
    }
    if (entries.length === 0) break;
  }

  const limit = Math.ceil(PAGE_SIZE / k);
  return picked.map((direction) => {
    const size = directionSize(direction, meta);
    const floor = scoreFloorFor(size, minScore);
    // Later pages reach deeper into each direction — `sort:random` is
    // unseeded upstream, but only ever paging the first few hundred results
    // kept the feed circling the same slice. Never deeper than the direction
    // plausibly has results for.
    const reachable =
      size === undefined ? MAX_PID : Math.floor(size / Math.max(1, limit));
    const depth = Math.max(1, Math.min(3 + page, MAX_PID, reachable));
    return {
      tags: [
        direction,
        ...filterSeeds,
        ...(floor > 0 ? [`score:>=${floor}`] : []),
        "sort:random",
      ].join(" "),
      pid: Math.floor(rng() * depth),
      limit,
    };
  });
}

/**
 * The post's most distinctive tags, for "more like this". Tags with a
 * parenthetical qualifier (`character_(series)`-style) identify characters
 * and artists, which narrow a search the most; longer tags tend to be more
 * specific than shorter ones.
 */
export function distinctiveTags(
  post: Post,
  n = 3,
  meta?: TagMetaMap,
): string[] {
  const tags = [...new Set(post.tags.split(/\s+/))].filter(
    (t) => t.length > 0 && !isGenericTag(t, meta),
  );
  // With metadata available, "distinctive" stops being a guess: sort by how
  // rare and how identifying the tag actually is.
  if (meta && meta.size > 0) {
    const known = tags.filter((t) => meta.has(t));
    if (known.length > 0) {
      known.sort((a, b) => tagFactor(b, meta) - tagFactor(a, meta) || (a < b ? -1 : 1));
      return known.slice(0, n);
    }
  }
  tags.sort((a, b) => {
    const qa = a.includes("(") ? 1 : 0;
    const qb = b.includes("(") ? 1 : 0;
    if (qa !== qb) return qb - qa;
    if (a.length !== b.length) return b.length - a.length;
    return a < b ? -1 : 1;
  });
  return tags.slice(0, n);
}
