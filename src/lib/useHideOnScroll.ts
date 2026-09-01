"use client";

import { useEffect, useRef, useState } from "react";

/** Below this offset the header is always shown (top of the page). */
const TOP_ZONE = 80;
/** Ignore jitter and iOS rubber-banding under this delta. */
const MIN_DELTA = 8;

/**
 * Hide-on-scroll-down / show-on-scroll-up for the sticky header. Returns
 * false whenever `forceShow` is set, so an open dropdown or sheet can pin
 * the header in place.
 */
export function useHideOnScroll(forceShow = false): boolean {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const frame = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;

    function update() {
      frame.current = 0;
      const y = window.scrollY;
      const delta = y - lastY.current;
      if (Math.abs(delta) < MIN_DELTA) return;
      lastY.current = y;
      setHidden(y > TOP_ZONE && delta > 0);
    }

    function onScroll() {
      if (frame.current) return;
      frame.current = requestAnimationFrame(update);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, []);

  return hidden && !forceShow;
}
