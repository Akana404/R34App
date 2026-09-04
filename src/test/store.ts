import Database from "better-sqlite3";
import { act } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import { createSchema, type Db } from "@/lib/db";
import { hydrateContent, resetContent } from "@/lib/prefs";
import type { AppSnapshot } from "@/lib/state";
import * as store from "@/lib/store";
import { resetTagMeta } from "@/lib/tagmeta";

/**
 * A real store behind a stubbed `fetch`.
 *
 * The client keeps a mirror and writes through to `/api/state`, so testing it
 * against a hand-written mock would only prove the mock agrees with itself.
 * This routes those requests into an in-memory SQLite database running the
 * production SQL instead, which means the caps, the ordering and the
 * server-authoritative responses are all the real ones.
 */

type Route = (url: URL, init?: RequestInit) => unknown;

export interface StoreHarness {
  db: Db;
  fetchMock: Mock;
  /** Answers requests the state route doesn't own, e.g. `/api/posts`. */
  route(pathname: string, handler: Route): void;
  /** Makes every write fail, for the "couldn't save" path. */
  breakWrites(): void;
  /** Lets the pending write-through settle. */
  settle(): Promise<void>;
}

export interface Seed extends Partial<AppSnapshot> {
  tagMeta?: store.TagMetaEntry[];
}

export function installStore(seed: Seed = {}): StoreHarness {
  resetContent();
  resetTagMeta();

  const db = createSchema(new Database(":memory:"));
  store.replaceSnapshot(db, {
    likes: seed.likes ?? [],
    dismissed: seed.dismissed ?? [],
    seen: seed.seen ?? [],
    seeds: seed.seeds ?? [],
    blocked: seed.blocked ?? [],
    tagMeta: seed.tagMeta,
  });

  const routes = new Map<string, Route>();
  let writesBroken = false;

  function state(url: URL, init?: RequestInit): unknown {
    if (init?.method !== "POST") {
      const part = url.searchParams.get("part");
      if (part === "likePosts") return store.readLikePosts(db);
      if (part === "tagMeta") return store.readTagMeta(db);
      return store.readSnapshot(db);
    }
    if (writesBroken) throw new Error("write failed");
    const body = JSON.parse(String(init.body));
    switch (body.action) {
      case "toggleLike":
        return store.toggleLike(db, body.post);
      case "dismiss":
        return store.dismiss(db, body.post);
      case "undismiss":
        return store.undismiss(db, body.id);
      case "clearDismissed":
        return store.clearDismissed(db);
      case "recordSeen":
        store.recordSeen(db, body.ids);
        return { ok: true };
      case "setSeeds":
        return store.setSeeds(db, body.tags);
      case "setBlockedTags":
        return store.setBlockedTags(db, body.tags);
      case "recordTagInfo":
        store.recordTagInfo(db, body.entries);
        return { ok: true };
      default:
        throw new Error(`unknown action ${body.action}`);
    }
  }

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const handler = url.pathname === "/api/state" ? state : routes.get(url.pathname);
    if (!handler) throw new Error(`no stub for ${url.pathname}`);
    return new Response(JSON.stringify(handler(url, init)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  hydrateContent(store.readSnapshot(db));

  return {
    db,
    fetchMock,
    route: (pathname, handler) => routes.set(pathname, handler),
    breakWrites: () => {
      writesBroken = true;
    },
    settle: async () => {
      // Two turns: one for the fetch, one for the handler that applies it.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}
