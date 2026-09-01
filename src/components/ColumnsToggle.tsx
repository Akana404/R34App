"use client";

import { useMobileColumns } from "@/lib/prefs";
import { SingleColumnIcon, TwoColumnsIcon } from "./icons";

/** Mobile-only 1/2-column switch for the masonry grid. */
export function ColumnsToggle() {
  const [mobileColumns, toggleColumns] = useMobileColumns();

  return (
    <button
      onClick={toggleColumns}
      className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-sm text-neutral-300 hover:border-neutral-500 sm:hidden"
      aria-label={
        mobileColumns === 2 ? "Switch to single column" : "Switch to two columns"
      }
    >
      {mobileColumns === 2 ? (
        <SingleColumnIcon className="size-5" />
      ) : (
        <TwoColumnsIcon className="size-5" />
      )}
    </button>
  );
}
