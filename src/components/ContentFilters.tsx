"use client";

import { SearchBar } from "@/components/SearchBar";
import { RATINGS, useBlockedTags, useRating, type Rating } from "@/lib/prefs";

const LABELS: Record<Rating, string> = {
  "": "Any rating",
  safe: "Safe",
  questionable: "Questionable",
  explicit: "Explicit",
};

/**
 * Rating picker for the header controls. Full width in the mobile sheet
 * (where the label above it names it), inline on desktop.
 */
export function RatingSelect() {
  const [rating, setRating] = useRating();

  return (
    <label className="w-full sm:contents">
      <span className="mb-1 block text-xs tracking-wide text-neutral-500 uppercase sm:hidden">
        Rating
      </span>
      <select
        value={rating}
        onChange={(e) => setRating(e.target.value as Rating)}
        aria-label="Rating"
        className={`min-h-11 w-full min-w-0 rounded-lg border bg-neutral-900 px-3 text-sm outline-none sm:min-h-0 sm:w-auto sm:py-2 ${
          rating
            ? "border-indigo-500/60 text-indigo-200"
            : "border-neutral-700 text-neutral-300 hover:border-neutral-500"
        }`}
      >
        {RATINGS.map((value) => (
          <option key={value} value={value}>
            {LABELS[value]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The blocked-tag editor. `standalone` gives it its own panel chrome; inside
 * an existing panel (the For You taste box) it renders as a plain section.
 */
export function BlockedTagsPanel({ standalone = false }: { standalone?: boolean }) {
  const { blocked, setBlockedTags } = useBlockedTags();

  return (
    <section
      className={
        standalone
          ? "mb-6 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4"
          : "mt-4"
      }
    >
      <h2 className="mb-2 text-sm font-semibold text-neutral-300">
        Blocked tags
      </h2>
      <SearchBar tags={blocked} onChange={setBlockedTags} />
      <p className="mt-2 text-xs text-neutral-500">
        Excluded from every search and from For You. Metatags like{" "}
        <code>sort:</code> aren&apos;t accepted here.
      </p>
    </section>
  );
}
