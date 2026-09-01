"use client";

import { useHideAi } from "@/lib/prefs";
import { CheckIcon } from "./icons";

export function HideAiToggle() {
  const [hideAi, toggle] = useHideAi();

  return (
    <button
      onClick={toggle}
      aria-pressed={hideAi}
      title={hideAi ? "AI posts are hidden" : "Hide AI-generated posts"}
      className={`flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm whitespace-nowrap transition-colors sm:min-h-0 sm:w-auto sm:py-1.5 ${
        hideAi
          ? "border-indigo-500/60 bg-indigo-600/30 text-indigo-200"
          : "border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500"
      }`}
    >
      {hideAi && <CheckIcon className="size-4" />}
      No AI
    </button>
  );
}
