"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HeartIcon, SearchIcon, SparkIcon } from "./icons";

export const TABS = [
  { href: "/", label: "Browse", Icon: SearchIcon },
  { href: "/for-you", label: "For You", Icon: SparkIcon },
  { href: "/likes", label: "Liked", Icon: HeartIcon },
] as const;

/** Desktop navigation; below `sm` the BottomNav takes over. */
export function NavTabs() {
  const pathname = usePathname();

  return (
    <nav className="hidden shrink-0 gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1 sm:flex">
      {TABS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={`rounded-md px-3 py-1 text-sm whitespace-nowrap transition-colors ${
            pathname === href
              ? "bg-indigo-600/30 text-indigo-200"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
