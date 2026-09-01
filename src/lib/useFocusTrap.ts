"use client";

import { useEffect, type RefObject } from "react";

/**
 * Whether an element can actually take focus. `checkVisibility` accounts for
 * hidden ancestors too, which matters here: the header and lightbox keep
 * `sm:hidden` duplicates of their controls in the DOM, and treating one as
 * the last stop meant the wrap never fired and Tab walked out of the dialog.
 */
function isRendered(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function") return el.checkVisibility();
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Keeps Tab inside a modal: without it, tabbing walks out of the dialog into
 * the page behind, which for a keyboard or screen-reader user means losing
 * the dialog with no way back.
 *
 * Focus moves into the container on open; where it lands afterwards is left
 * alone, so a dialog can focus its own primary control.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active = true,
) {
  useEffect(() => {
    const container = ref.current;
    if (!active || !container) return;

    const previous = document.activeElement as HTMLElement | null;
    if (!container.contains(document.activeElement)) container.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !container) return;
      const items = [
        ...container.querySelectorAll<HTMLElement>(FOCUSABLE),
      ].filter(isRendered);
      if (items.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || current === container)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Hand focus back to whatever opened the dialog.
      previous?.focus?.();
    };
  }, [ref, active]);
}
