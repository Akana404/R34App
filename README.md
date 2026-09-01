# R34 Browser

A modern, locally running web UI for browsing Rule34 content via the [rule34.xxx API](https://rule34.xxx) — tag search with autocomplete, a masonry grid with infinite scroll, a fullscreen viewer, and a client-side "For You" feed that learns from what you like.

> Intended for private, local use only. Note the [API terms of service](RULE34_API.md): no advertisements, no paywalls, only one API key.

## Features

- **Tag search with autocomplete** — tags as chips, suggestions with post counts, keyboard navigation (↑↓, Enter, Escape, Backspace removes the last chip); the search syncs to the URL
- **Masonry grid** — responsive 1–5 columns (with a 1/2-column toggle on phones), lazy loading, video/GIF badges, hover actions (like, not interested, more like this)
- **Infinite scroll** — loads more automatically (100 posts per page), deduplicated by post ID; a failed later page never discards what is already on screen
- **Lightbox** — fullscreen viewer with keyboard (←/→, `i`, Esc) and swipe navigation, inline video playback, category-coloured tag list, and its own feed paging so you can browse past the loaded posts
- **For You feed** — pure client-side recommendations built from your likes and seed tags: rare and identifying tags weigh more, dismissals count against, repeats get down-ranked; reproducible until you hit Shuffle
- **Likes** — capped at 500, browsable on their own page, with near-cap warning
- **Content filters** — rating filter, blocked tags, and a hide-AI toggle, applied to every feed upstream in the query
- **Backup / restore** — export the whole state as versioned JSON and import it back (merge or replace)
- **API proxy** — the browser only talks to local routes; the API key stays server-side and never appears in the client
- **No accounts, no server state** — every preference lives in your browser's localStorage

## Setup

1. Get an API key: [rule34.xxx → Account → Options](https://rule34.xxx/index.php?page=account&s=options) → API Access Credentials
2. Copy `.env.example` to `.env` and fill in the values:

   ```env
   API_KEY=your_api_key
   USER_ID=your_user_id
   ```

3. Install and run:

   ```sh
   npm install
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

Started without credentials, the app shows these setup steps in place of the feed.

## Stack

| Area | Technology |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript, Turbopack) |
| Styling | Tailwind CSS v4 |
| Data fetching | TanStack Query v5 (`useInfiniteQuery`) |
| Validation | Zod (API responses are untyped/inconsistent) |
| Tests | Vitest + Testing Library (jsdom) |

## Architecture

```
Browser (React UI, all preferences in localStorage)
   │  /api/posts?tags=...&page=N
   │  /api/autocomplete?q=...
   ▼
Next.js Route Handlers (localhost)
   │  + api_key & user_id from .env
   ▼
api.rule34.xxx

Media (images/videos) is loaded by the browser directly from the rule34 CDN.
```

### Project structure

```
src/
  app/
    page.tsx                  # Browse: search bar + grid
    for-you/page.tsx          # For You: recommendation feed
    likes/page.tsx            # Liked posts + backup/import
    api/posts/route.ts        # Proxy: post search (dapi, json=1)
    api/autocomplete/route.ts # Proxy: tag autocomplete
  lib/
    r34.ts                    # Server-side API client
    types.ts                  # Zod schemas + types
    prefs.ts                  # localStorage stores (likes, filters, …)
    recommend.ts              # Taste profile + For You query builder
    tagmeta.ts                # Per-tag category/count cache
    backup.ts                 # Versioned export/import
  components/
    SearchBar.tsx             # Tag chips + autocomplete dropdown
    PostGrid.tsx              # Infinite scroll + per-page filter/rank
    MasonryColumns.tsx        # Column packing + lightbox owner
    Lightbox.tsx              # Fullscreen viewer
    ForYouFeed.tsx            # Recommendation feed page body
    LikesView.tsx             # Liked page body
    AppHeader.tsx / BottomNav.tsx / ControlSheet.tsx  # Shared chrome
```

`CLAUDE.md` documents the architectural invariants in more detail.

## Scripts

- `npm run dev` — dev server on port 3000
- `npm run build` — production build (includes the TypeScript check)
- `npm run start` — production server
- `npm run lint` — ESLint
- `npm test` — test suite (`npm run test:watch` to iterate, `npm run test:coverage` for coverage)
