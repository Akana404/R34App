"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { TagMetaSync } from "@/components/TagMetaSync";
import { hydrateContent } from "@/lib/prefs";
import type { AppSnapshot } from "@/lib/state";

export function Providers({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState: AppSnapshot;
}) {
  // Seeded during render, above `children`, so every store hook already sees
  // the real state on its first render — an effect would cost an empty frame.
  hydrateContent(initialState);

  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      <TagMetaSync />
    </QueryClientProvider>
  );
}
