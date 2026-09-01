"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useFocusTrap } from "@/lib/useFocusTrap";

interface ControlSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

/**
 * Mobile bottom sheet for the secondary controls. Buttons inside that should
 * dismiss it on activation carry `data-sheet-close`.
 */
export function ControlSheet({
  open,
  onClose,
  title = "Options",
  children,
}: ControlSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 sm:hidden">
      <button
        className="absolute inset-0 h-full w-full bg-black/60"
        aria-label="Close options"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-sheet-close]")) onClose();
        }}
        className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-neutral-800 bg-neutral-900 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl outline-none"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-700" />
        <h2 className="mb-3 text-sm font-semibold text-neutral-400">{title}</h2>
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}
