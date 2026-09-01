import { describe, expect, it } from "vitest";
import type { LikedPost } from "@/lib/prefs";
import type { Post, TagCategory, TagMetaMap } from "@/lib/types";
import {
  applyDismissals,
  buildForYouQueries,
  computeDirectionWeights,
  computeTagPairs,
  computeTagWeights,
  recencyWeight,
  distinctiveTags,
  isGenericTag,
  isMetaTag,
  mulberry32,
  rankScore,
  scorePost,
  tagFactor,
  topWeightedTags,
} from "@/lib/recommend";

/** Fixed "now" so recency decay is deterministic in tests. */
const NOW = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;

function like(tags: string[], likedAt = NOW): LikedPost {
  return {
    id: Math.round(Math.random() * 1e9),
    tags,
    score: 10,
    rating: "explicit",
    likedAt,
  };
}

function post(tags: string[], overrides: Partial<Post> = {}): Post {
  return {
    id: 1,
    preview_url: "p",
    sample_url: "s",
    file_url: "f",
    width: 100,
    height: 100,
    sample_width: 100,
    sample_height: 100,
    rating: "explicit",
    score: 10,
    tags: tags.join(" "),
    owner: "o",
    change: 0,
    comment_count: 0,
    ...overrides,
  };
}

function meta(
  entries: [tag: string, count: number, category?: TagCategory][],
): TagMetaMap {
  return new Map(
    entries.map(([tag, count, category = "tag"]) => [tag, { count, category }]),
  );
}

describe("isMetaTag / isGenericTag", () => {
  it("recognises metatags including negated ones", () => {
    expect(isMetaTag("rating:safe")).toBe(true);
    expect(isMetaTag("-rating:explicit")).toBe(true);
    expect(isMetaTag("sort:score:desc")).toBe(true);
    expect(isMetaTag("score:>=10")).toBe(true);
    expect(isMetaTag("hatsune_miku")).toBe(false);
  });

  it("treats stoplist tags and metatags as generic", () => {
    expect(isGenericTag("1girls")).toBe(true);
    expect(isGenericTag("sort:random")).toBe(true);
    expect(isGenericTag("hatsune_miku")).toBe(false);
  });
});

describe("isGenericTag with tag metadata", () => {
  it("calls a tag generic once it covers a huge share of the site", () => {
    expect(isGenericTag("everywhere", meta([["everywhere", 5_000_000]]))).toBe(
      true,
    );
    expect(isGenericTag("niche", meta([["niche", 900]]))).toBe(false);
  });

  it("holds technical metadata to a much lower bar", () => {
    const m = meta([
      ["3d", 1_400_000, "metadata"],
      ["some_style", 5_000, "metadata"],
    ]);
    expect(isGenericTag("3d", m)).toBe(true);
    expect(isGenericTag("some_style", m)).toBe(false);
  });

  it("keeps applying the hardcoded stoplist to unknown tags", () => {
    expect(isGenericTag("1girls", meta([["other", 5]]))).toBe(true);
  });
});

describe("tagFactor", () => {
  it("is neutral for tags with no metadata yet", () => {
    expect(tagFactor("unknown")).toBe(1);
    expect(tagFactor("unknown", meta([["other", 10]]))).toBe(1);
  });

  it("rewards rare tags over common ones", () => {
    const m = meta([
      ["rare", 200],
      ["common", 900_000],
    ]);
    expect(tagFactor("rare", m)).toBeGreaterThan(tagFactor("common", m));
  });

  it("boosts identifying categories over plain tags", () => {
    const m = meta([
      ["an_artist", 5_000, "artist"],
      ["a_character", 5_000, "character"],
      ["a_series", 5_000, "copyright"],
      ["a_tag", 5_000, "tag"],
      ["a_style", 5_000, "metadata"],
    ]);
    expect(tagFactor("an_artist", m)).toBeGreaterThan(tagFactor("a_tag", m));
    expect(tagFactor("a_character", m)).toBeGreaterThan(tagFactor("a_tag", m));
    expect(tagFactor("a_series", m)).toBeGreaterThan(tagFactor("a_tag", m));
    expect(tagFactor("a_style", m)).toBeLessThan(tagFactor("a_tag", m));
  });
});

describe("recencyWeight", () => {
  it("counts a fresh like fully and halves it after the half-life", () => {
    expect(recencyWeight(NOW, NOW)).toBe(1);
    expect(recencyWeight(NOW - 45 * DAY, NOW)).toBeCloseTo(0.5, 5);
  });

  it("never decays a like away entirely", () => {
    expect(recencyWeight(NOW - 3650 * DAY, NOW)).toBeGreaterThan(0);
    expect(recencyWeight(NOW - 3650 * DAY, NOW)).toBe(
      recencyWeight(NOW - 7300 * DAY, NOW),
    );
  });

  it("treats a like from the future as fresh rather than negative", () => {
    expect(recencyWeight(NOW + DAY, NOW)).toBe(1);
  });
});

describe("computeTagWeights", () => {
  it("counts a tag once per liked post and skips generic tags", () => {
    const weights = computeTagWeights(
      [like(["miku", "miku", "1girls", "blue_hair"]), like(["miku", "solo"])],
      undefined,
      NOW,
    );
    expect(weights.get("miku")).toBe(2);
    expect(weights.get("blue_hair")).toBe(1);
    expect(weights.has("1girls")).toBe(false);
    expect(weights.has("solo")).toBe(false);
  });

  it("keeps the long tail while the profile is small", () => {
    const weights = computeTagWeights(
      [like(["a", "b"]), like(["c"])],
      undefined,
      NOW,
    );
    expect([...weights.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("weighs a recent like above an old one", () => {
    const weights = computeTagWeights(
      [like(["fresh"]), like(["stale"], NOW - 90 * DAY)],
      undefined,
      NOW,
    );
    expect(weights.get("fresh")!).toBeGreaterThan(weights.get("stale")!);
  });

  it("keeps a tag that dominates the profile — that IS the taste", () => {
    const likes = Array.from({ length: 10 }, () => like(["signature", "misc"]));
    const weights = computeTagWeights(likes, undefined, NOW);
    expect(weights.get("signature")).toBe(10);
    // …while the direction pool drops it, since it narrows nothing.
    expect(computeDirectionWeights(likes).has("signature")).toBe(false);
  });
});

function dismissal(tags: string[], dismissedAt = NOW) {
  return { id: Math.round(Math.random() * 1e9), tags, dismissedAt };
}

describe("applyDismissals", () => {
  it("leaves the profile untouched when nothing was dismissed", () => {
    const profile = new Map([["a", 3]]);
    expect(applyDismissals(profile, [])).toBe(profile);
  });

  it("weakens a tag that shows up in dismissed posts", () => {
    const profile = computeTagWeights([like(["a"]), like(["a"])], undefined, NOW);
    const after = applyDismissals(profile, [dismissal(["a"])], undefined, NOW);
    expect(after.get("a")!).toBeLessThan(profile.get("a")!);
    expect(after.get("a")!).toBeGreaterThan(0);
  });

  it("counts a dismissal for less than a like, so one bad post can't erase a tag", () => {
    const profile = computeTagWeights([like(["a"])], undefined, NOW);
    const after = applyDismissals(profile, [dismissal(["a"])], undefined, NOW);
    expect(after.get("a")!).toBeGreaterThan(0);
  });

  it("drives a tag you only ever dismissed negative", () => {
    const profile = computeTagWeights([like(["a"])], undefined, NOW);
    const after = applyDismissals(profile, [dismissal(["b"])], undefined, NOW);
    expect(after.get("b")!).toBeLessThan(0);
  });

  it("ranks a post carrying dismissed tags below one that doesn't", () => {
    const profile = applyDismissals(
      computeTagWeights([like(["good", "shared"])], undefined, NOW),
      [dismissal(["bad", "shared"])],
      undefined,
      NOW,
    );
    expect(rankScore(post(["good"]), profile)).toBeGreaterThan(
      rankScore(post(["bad"]), profile),
    );
  });

  it("decays old dismissals like old likes", () => {
    const recent = applyDismissals(
      new Map([["a", 5]]),
      [dismissal(["a"])],
      undefined,
      NOW,
    );
    const old = applyDismissals(
      new Map([["a", 5]]),
      [dismissal(["a"], NOW - 400 * DAY)],
      undefined,
      NOW,
    );
    expect(old.get("a")!).toBeGreaterThan(recent.get("a")!);
  });
});

describe("computeDirectionWeights", () => {
  it("drops one-off noise once there are enough likes", () => {
    const likes = [
      like(["core", "one_off_a"]),
      like(["core", "one_off_b"]),
      like(["core", "shared"]),
      like(["other", "shared"]),
      like(["other", "one_off_c"]),
    ];
    const directions = computeDirectionWeights(likes);
    expect(directions.get("core")).toBe(3);
    expect(directions.get("shared")).toBe(2);
    expect(directions.has("one_off_a")).toBe(false);
  });

  it("ignores recency — a direction is about how often, not how lately", () => {
    const likes = [
      like(["a", "b"], NOW - 900 * DAY),
      like(["a", "b"], NOW - 900 * DAY),
    ];
    expect(computeDirectionWeights(likes).get("a")).toBe(2);
  });

  it("keeps the long tail while the profile is small", () => {
    expect([...computeDirectionWeights([like(["a"]), like(["b"])]).keys()].sort())
      .toEqual(["a", "b"]);
  });
});

describe("computeTagWeights with tag metadata", () => {
  it("ranks a rare tag above an equally liked common one", () => {
    const likes = [like(["rare", "common"]), like(["rare", "common"])];
    const m = meta([
      ["rare", 300],
      ["common", 800_000],
    ]);
    const weights = computeTagWeights(likes, m, NOW);
    expect(weights.get("rare")!).toBeGreaterThan(weights.get("common")!);
    // Without metadata the two are indistinguishable.
    const plain = computeTagWeights(likes, undefined, NOW);
    expect(plain.get("rare")).toBe(plain.get("common"));
  });

  it("drops tags the metadata proves to be site-wide filler", () => {
    const likes = [like(["keep", "filler"]), like(["keep", "filler"])];
    const weights = computeTagWeights(likes, meta([["filler", 4_000_000]]), NOW);
    expect(weights.has("filler")).toBe(false);
    expect(weights.has("keep")).toBe(true);
  });
});

describe("topWeightedTags", () => {
  it("sorts by weight, then alphabetically, and truncates", () => {
    const weights = new Map([
      ["b", 2],
      ["a", 2],
      ["c", 5],
      ["d", 1],
    ]);
    expect(topWeightedTags(weights, 3).map((t) => t.tag)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("computeTagPairs", () => {
  it("counts co-occurring pairs order-independently", () => {
    const likes = [like(["a", "b"]), like(["b", "a"]), like(["a", "c"])];
    const pairs = computeTagPairs(likes, computeDirectionWeights(likes));
    const byKey = new Map(pairs.map((p) => [p.tag, p.weight]));
    expect(byKey.get("a b")).toBe(2);
    expect(byKey.get("a c")).toBe(1);
  });

  it("only pairs tags that survived weighting", () => {
    const likes = [like(["a", "1girls"]), like(["a", "1girls"])];
    const pairs = computeTagPairs(likes, computeDirectionWeights(likes));
    expect(pairs.every((p) => !p.tag.includes("1girls"))).toBe(true);
  });
});

describe("scorePost", () => {
  it("sums profile weights over the post's distinct tags", () => {
    const profile = new Map([
      ["a", 3],
      ["b", 1],
    ]);
    expect(scorePost(post(["a", "b", "unknown"]), profile)).toBe(4);
    expect(scorePost(post(["a", "a"]), profile)).toBe(3);
  });

  it("is zero for a post sharing nothing with the profile", () => {
    expect(scorePost(post(["x"]), new Map([["a", 3]]))).toBe(0);
  });
});

describe("rankScore", () => {
  const profile = new Map([
    ["a", 4],
    ["b", 4],
  ]);

  it("ranks a focused match above a post that merely carries many tags", () => {
    const focused = post(["a", "b", "x"]);
    const bloated = post(["a", "b", ...Array.from({ length: 40 }, (_, i) => `t${i}`)]);
    expect(rankScore(focused, profile)).toBeGreaterThan(
      rankScore(bloated, profile),
    );
    // The unnormalised score cannot tell them apart at all.
    expect(scorePost(focused, profile)).toBe(scorePost(bloated, profile));
  });

  it("still prefers more profile matches at equal length", () => {
    expect(rankScore(post(["a", "b", "x"]), profile)).toBeGreaterThan(
      rankScore(post(["a", "x", "y"]), profile),
    );
  });

  it("is zero for a post with no tags", () => {
    expect(rankScore(post([]), profile)).toBe(0);
  });
});

describe("mulberry32", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
  });
});

describe("distinctiveTags", () => {
  it("prefers qualified tags, then longer ones, and skips generic tags", () => {
    const tags = distinctiveTags(
      post(["1girls", "blue", "long_specific_tag", "miku_(vocaloid)"]),
      2,
    );
    expect(tags[0]).toBe("miku_(vocaloid)");
    expect(tags[1]).toBe("long_specific_tag");
  });

  it("prefers the rarest identifying tags when metadata is available", () => {
    const m = meta([
      ["popular_series", 500_000, "copyright"],
      ["rare_artist", 300, "artist"],
      ["mid_tag", 20_000],
    ]);
    expect(distinctiveTags(post(["popular_series", "rare_artist", "mid_tag"]), 1, m)).toEqual(
      ["rare_artist"],
    );
  });

  it("falls back to the shape heuristic for tags with no metadata", () => {
    expect(
      distinctiveTags(post(["short", "miku_(vocaloid)"]), 1, meta([["x", 1]])),
    ).toEqual(["miku_(vocaloid)"]);
  });

  it("returns nothing when every tag is generic", () => {
    expect(distinctiveTags(post(["1girls", "solo"]))).toEqual([]);
  });
});

/** The tag part of a sub-query, with the filters and sort stripped off. */
function directionOf(query: { tags: string }): string {
  return query.tags
    .split(" ")
    .filter((tag) => !isMetaTag(tag))
    .join(" ");
}

describe("buildForYouQueries", () => {
  const base = {
    seeds: [],
    likedTop: [{ tag: "a", weight: 3 }],
    pairs: [
      { tag: "a b", weight: 3 },
      { tag: "c d", weight: 2 },
      { tag: "e f", weight: 1 },
    ],
    page: 0,
    shuffleSeed: 7,
  };

  it("returns nothing without any taste to build from", () => {
    expect(
      buildForYouQueries({ ...base, likedTop: [], pairs: [], seeds: [] }),
    ).toEqual([]);
  });

  it("builds one query per direction with a score floor and random sort", () => {
    const queries = buildForYouQueries(base);
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.tags).toContain("score:>=10");
      expect(query.tags).toContain("sort:random");
      expect(query.limit).toBeGreaterThan(0);
    }
  });

  it("is reproducible for the same seed and page", () => {
    expect(buildForYouQueries(base)).toEqual(buildForYouQueries(base));
  });

  it("rotates directions across pages once the pool is bigger than a page", () => {
    const pool = {
      ...base,
      pairs: Array.from({ length: 10 }, (_, i) => ({
        tag: `t${i} u${i}`,
        weight: 10 - i,
      })),
    };
    const directions = (page: number) =>
      new Set(buildForYouQueries({ ...pool, page }).map(directionOf));
    const first = directions(0);
    const later = [1, 2, 3].map(directions);
    expect(later.some((set) => [...set].some((d) => !first.has(d)))).toBe(true);
  });

  it("varies the shuffle seed", () => {
    const a = buildForYouQueries({ ...base, shuffleSeed: 1 });
    const b = buildForYouQueries({ ...base, shuffleSeed: 999 });
    expect(a).not.toEqual(b);
  });

  it("never samples the same direction twice on a page", () => {
    const directions = buildForYouQueries(base).map(directionOf);
    expect(new Set(directions).size).toBe(directions.length);
  });

  it("never pairs a direction with one nested inside it", () => {
    for (let page = 0; page < 25; page++) {
      const directions = buildForYouQueries({ ...base, page }).map((q) =>
        directionOf(q).split(" "),
      );
      for (const a of directions) {
        for (const b of directions) {
          if (a === b) continue;
          expect(a.every((tag) => b.includes(tag))).toBe(false);
        }
      }
    }
  });

  it("applies metatag seeds as filters on every sub-query", () => {
    const queries = buildForYouQueries({
      ...base,
      seeds: ["rating:safe", "miku"],
    });
    expect(queries.every((q) => q.tags.includes("rating:safe"))).toBe(true);
    // …and never as a direction of their own.
    expect(queries.every((q) => !directionOf(q).includes("rating:safe"))).toBe(
      true,
    );
  });

  it("lets explicit seeds compete as directions", () => {
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      for (const query of buildForYouQueries({
        ...base,
        seeds: ["miku"],
        page,
      })) {
        seen.add(directionOf(query));
      }
    }
    expect(seen.has("miku")).toBe(true);
  });

  it("mixes single-tag directions in beside the pairs", () => {
    const pool = {
      ...base,
      pairs: Array.from({ length: 8 }, (_, i) => ({
        tag: `p${i} q${i}`,
        weight: 5,
      })),
      likedTop: Array.from({ length: 8 }, (_, i) => ({
        tag: `s${i}`,
        weight: 5,
      })),
    };
    const seen = new Set<string>();
    for (let page = 0; page < 40; page++) {
      for (const query of buildForYouQueries({ ...pool, page })) {
        seen.add(directionOf(query));
      }
    }
    expect([...seen].some((d) => !d.includes(" "))).toBe(true);
    expect([...seen].some((d) => d.includes(" "))).toBe(true);
  });

  it("reaches deeper into a direction on later pages", () => {
    const deep = (page: number) =>
      Math.max(
        ...Array.from({ length: 30 }, (_, seed) =>
          Math.max(
            ...buildForYouQueries({ ...base, page, shuffleSeed: seed }).map(
              (q) => q.pid,
            ),
          ),
        ),
      );
    expect(deep(12)).toBeGreaterThan(deep(0));
  });

  it("keeps the score floor for a direction with plenty of posts", () => {
    const queries = buildForYouQueries({
      ...base,
      meta: meta([
        ["a", 300_000],
        ["b", 300_000],
      ]),
    });
    const forAB = queries.find((q) => directionOf(q) === "a b");
    expect(forAB?.tags).toContain("score:>=10");
  });

  it("drops the score floor for a niche direction", () => {
    const queries = buildForYouQueries({
      ...base,
      meta: meta([
        ["a", 400],
        ["b", 900],
      ]),
    });
    const forAB = queries.find((q) => directionOf(q) === "a b");
    expect(forAB?.tags).not.toContain("score:");
  });

  it("halves the floor for a small-but-not-tiny direction", () => {
    const queries = buildForYouQueries({
      ...base,
      meta: meta([
        ["a", 8_000],
        ["b", 500_000],
      ]),
    });
    const forAB = queries.find((q) => directionOf(q) === "a b");
    expect(forAB?.tags).toContain("score:>=5");
  });

  it("does not page past what a niche direction can hold", () => {
    const queries = buildForYouQueries({
      ...base,
      page: 15,
      meta: meta([
        ["a", 40],
        ["b", 40],
      ]),
    });
    // Only the direction we have metadata for is constrained; the others
    // are unknown-size and may still page deep.
    expect(queries.find((q) => directionOf(q) === "a b")?.pid).toBe(0);
  });

  it("falls back to single learned tags when there are too few pairs", () => {
    const queries = buildForYouQueries({
      ...base,
      pairs: [{ tag: "a b", weight: 3 }],
      likedTop: [
        { tag: "a", weight: 3 },
        { tag: "b", weight: 2 },
        { tag: "c", weight: 1 },
      ],
    });
    expect(queries.length).toBeGreaterThan(1);
  });
});
