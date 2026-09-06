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
- **Shared across your browsers** — likes, dismissals, seed and blocked tags and the learned tag metadata live in a local SQLite file next to the app, so every browser and device pointing at the same instance sees the same data. No accounts and no login: one dataset per running instance
- **API proxy** — the browser only talks to local routes; the API key stays server-side and never appears in the client

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

### Your data

Everything the app remembers is written to `data/r34-browser.sqlite` (override
with `DB_PATH` in `.env`). The file is created on first run and is the backup:
copy it to keep your likes, delete it to start over. Only the three per-browser
display switches — mobile column count, hide-AI, and the rating filter — stay in
that browser's `localStorage`.

Coming from an older build that kept everything in `localStorage`? Export that
JSON, drop it in `old/`, and run it in once:

```sh
npm run import-backup -- old/your-export.json
```

It replaces the database contents, accepts either the old backup envelope or a
raw dump of the `localStorage` keys, and skips entries it can't read rather than
refusing the whole file.

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
Browser (React UI, mirroring the server state in memory)
   │  /api/posts?tags=...&page=N        /api/state          (GET + POST)
   │  /api/autocomplete?q=...              │
   ▼                                       ▼
Next.js Route Handlers (localhost)    data/r34-browser.sqlite
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
    likes/page.tsx            # Liked posts
    layout.tsx                # Reads the state snapshot for the first render
    api/posts/route.ts        # Proxy: post search (dapi, json=1)
    api/autocomplete/route.ts # Proxy: tag autocomplete
    api/state/route.ts        # The stored state: snapshot + one mutation
  lib/
    r34.ts                    # Server-side API client
    types.ts                  # Zod schemas + types
    state.ts                  # Shared row types and caps
    db.ts                     # SQLite handle + schema
    store.ts                  # Every read/write, caps enforced in SQL
    prefs.ts                  # Client mirror + the browser-local switches
    recommend.ts              # Taste profile + For You query builder
    tagmeta.ts                # Per-tag category/count cache
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
- `npm run import-backup -- <file.json>` — one-off import of an old localStorage export
