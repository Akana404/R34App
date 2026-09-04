import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/BottomNav";
import { getDb } from "@/lib/db";
import { readSnapshot } from "@/lib/store";
import type { AppSnapshot } from "@/lib/state";
import { Providers } from "./providers";

const EMPTY_STATE: AppSnapshot = {
  likes: [],
  dismissed: [],
  seen: [],
  seeds: [],
  blocked: [],
};

// The layout reads the store on every request, so it must never be
// prerendered — a static shell would freeze whatever was in the database at
// build time into every page.
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "R34 Browser",
  description: "Local rule34 browser",
};

// `viewport-fit=cover` is what makes the `env(safe-area-inset-*)` padding in
// the bottom nav, the sheets and the lightbox resolve to anything but 0.
export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Read straight from the store rather than fetching our own API. An
  // unreachable database costs the page its saved state, not its render.
  let initialState = EMPTY_STATE;
  try {
    initialState = readSnapshot(getDb());
  } catch (err) {
    console.error("could not read the saved state:", err);
  }

  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        <Providers initialState={initialState}>
          {children}
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
