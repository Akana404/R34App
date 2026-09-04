"use client";

import { useState, type ReactNode } from "react";
import { ColumnsToggle } from "./ColumnsToggle";
import { ControlSheet } from "./ControlSheet";
import { NavTabs } from "./NavTabs";
import { SlidersIcon } from "./icons";
import { useHideOnScroll } from "@/lib/useHideOnScroll";
import { useStorageWarning } from "@/lib/prefs";

interface AppHeaderProps {
  /** Full-width search field (Browse). */
  search?: ReactNode;
  /**
   * Secondary controls. Rendered inline from `sm` up and inside the mobile
   * sheet when it is open — they must keep their state in `prefs.ts` or in
   * the owning page, never in local state of the passed nodes.
   */
  controls?: ReactNode;
  /** Any control is off its default → the sheet trigger gets a dot. */
  controlsActive?: boolean;
  /** Right-aligned text (Liked). */
  aside?: ReactNode;
  /** Pin the header, e.g. while the autocomplete list is open. */
  forceShow?: boolean;
}

export function AppHeader({
  search,
  controls,
  controlsActive = false,
  aside,
  forceShow = false,
}: AppHeaderProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Never slide away under a focused search field / open autocomplete list.
  const [focusWithin, setFocusWithin] = useState(false);
  const hidden = useHideOnScroll(forceShow || sheetOpen || focusWithin);
  const saveFailed = useStorageWarning();

  // The sheet renders outside the header: a transformed ancestor would become
  // the containing block for its `fixed` positioning.
  //
  // From `sm` up the header is one row, but that row only genuinely fits at
  // desktop widths. So it wraps: each group keeps its natural size and moves
  // to a second line instead of being squeezed until the nav tabs overlap the
  // search field and the last button hangs off the side.
  return (
    <>
      <header
        onFocusCapture={() => setFocusWithin(true)}
        onBlurCapture={() => setFocusWithin(false)}
        className={`sticky top-0 z-20 -mx-4 mb-4 flex flex-col items-stretch gap-2 bg-neutral-950/90 px-4 py-3 backdrop-blur transition-transform duration-200 motion-reduce:transition-none sm:mb-6 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2 sm:py-4 ${
          hidden ? "-translate-y-full" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-2 sm:shrink-0">
          <h1 className="shrink-0 text-lg font-bold tracking-tight text-neutral-100">
            R34 <span className="text-indigo-400">Browser</span>
          </h1>
          <div className="flex items-center gap-2">
            <NavTabs />
            <ColumnsToggle />
            {controls && (
              <button
                onClick={() => setSheetOpen(true)}
                aria-label="Options"
                aria-expanded={sheetOpen}
                className="relative flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-300 hover:border-neutral-500 sm:hidden"
              >
                <SlidersIcon className="size-5" />
                {controlsActive && (
                  <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-indigo-400" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Grows into whatever the row has left, and is the first thing to
            give way — never below a usable width, at which point the groups
            after it wrap instead. */}
        {search && <div className="min-w-0 sm:flex-1 sm:basis-80">{search}</div>}

        {aside && <div className="min-w-0 sm:ml-auto sm:shrink-0">{aside}</div>}
        {controls && (
          <div className="hidden items-center gap-2 sm:ml-auto sm:flex sm:shrink-0">
            {controls}
          </div>
        )}
      </header>

      {saveFailed && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
        >
          Recent changes couldn&apos;t be saved and have been undone. Check
          that the app&apos;s server is still running, then try again.
        </p>
      )}

      {controls && (
        <ControlSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
          {controls}
        </ControlSheet>
      )}
    </>
  );
}
