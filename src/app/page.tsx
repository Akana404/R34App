"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import {
  BlockedTagsPanel,
  RatingSelect,
} from "@/components/ContentFilters";
import { HideAiToggle } from "@/components/HideAiToggle";
import { SearchBar } from "@/components/SearchBar";
import { PostGrid } from "@/components/PostGrid";
import {
  contentFilterTags,
  useBlockedTags,
  useHideAi,
  useMobileColumns,
  useRating,
} from "@/lib/prefs";

const SORT_OPTIONS = [
  { value: "", label: "Newest", tag: "" },
  { value: "score", label: "Top scored", tag: "sort:score:desc" },
  { value: "updated", label: "Recently updated", tag: "sort:updated:desc" },
  { value: "random", label: "Random", tag: "sort:random" },
] as const;

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mobileColumns] = useMobileColumns();
  const [hideAi] = useHideAi();
  const [rating] = useRating();
  const { blocked } = useBlockedTags();
  const [showFilters, setShowFilters] = useState(false);

  // The URL is the source of truth for the search, so searches survive
  // reloads and "more like this" can link here from anywhere.
  const tags = useMemo(
    () => (searchParams.get("tags") ?? "").split(" ").filter(Boolean),
    [searchParams],
  );
  const sort =
    SORT_OPTIONS.find((o) => o.value === searchParams.get("sort")) ??
    SORT_OPTIONS[0];

  function updateParams(next: { tags?: string[]; sort?: string }) {
    const params = new URLSearchParams(searchParams);
    if (next.tags !== undefined) {
      if (next.tags.length > 0) params.set("tags", next.tags.join(" "));
      else params.delete("tags");
    }
    if (next.sort !== undefined) {
      if (next.sort) params.set("sort", next.sort);
      else params.delete("sort");
    }
    const query = params.toString();
    router.replace(query ? `/?${query}` : "/", { scroll: false });
  }

  return (
    <main className="mx-auto w-full max-w-[1800px] px-4 pb-24 sm:pb-12">
      <AppHeader
        search={
          <SearchBar tags={tags} onChange={(next) => updateParams({ tags: next })} />
        }
        controlsActive={
          sort.value !== "" || hideAi || rating !== "" || blocked.length > 0
        }
        controls={
          <>
            {/* `sm:contents` keeps the select a direct flex child on desktop;
                the label text only exists in the mobile sheet. */}
            <label className="w-full sm:contents">
              <span className="mb-1 block text-xs tracking-wide text-neutral-500 uppercase sm:hidden">
                Sort
              </span>
              <select
                value={sort.value}
                onChange={(e) => updateParams({ sort: e.target.value })}
                aria-label="Sort posts"
                className="min-h-11 w-full min-w-0 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-300 outline-none hover:border-neutral-500 sm:min-h-0 sm:w-auto sm:py-2"
              >
                {SORT_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <RatingSelect />
            <HideAiToggle />
            <button
              data-sheet-close
              onClick={() => setShowFilters((s) => !s)}
              aria-expanded={showFilters}
              className={`min-h-11 w-full rounded-lg border px-3 text-sm whitespace-nowrap sm:min-h-0 sm:w-auto sm:py-1.5 ${
                blocked.length > 0
                  ? "border-indigo-500/60 bg-indigo-600/30 text-indigo-200"
                  : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
              }`}
            >
              Blocked{blocked.length > 0 ? ` (${blocked.length})` : ""}
            </button>
          </>
        }
      />

      {showFilters && <BlockedTagsPanel standalone />}

      <PostGrid
        tags={tags}
        extraTags={[
          sort.tag,
          contentFilterTags({ rating, blocked, hideAi }),
        ]
          .filter(Boolean)
          .join(" ")}
        mobileColumns={mobileColumns}
      />
    </main>
  );
}

export default function Home() {
  // useSearchParams requires a Suspense boundary at build time.
  return (
    <Suspense>
      <HomeInner />
    </Suspense>
  );
}
