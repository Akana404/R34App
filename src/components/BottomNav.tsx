"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TABS } from "./NavTabs";

/**
 * Mobile navigation. Lives in the root layout so it survives navigation;
 * `main` reserves room for it with `pb-24 sm:pb-12`.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-neutral-800 bg-neutral-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs transition-colors ${
              active ? "text-indigo-300" : "text-neutral-400"
            }`}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
