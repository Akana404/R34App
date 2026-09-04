import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Post } from "@/lib/types";

const getDb = vi.fn(() => ({}) as never);
vi.mock("@/lib/db", () => ({ getDb: () => getDb() }));

const store = {
  readSnapshot: vi.fn(),
  readLikePosts: vi.fn(),
  readTagMeta: vi.fn(),
  toggleLike: vi.fn(),
  dismiss: vi.fn(),
  undismiss: vi.fn(),
  clearDismissed: vi.fn(),
  recordSeen: vi.fn(),
  setSeeds: vi.fn(),
  setBlockedTags: vi.fn(),
  recordTagInfo: vi.fn(),
};
vi.mock("@/lib/store", () => store);

const { GET, POST } = await import("@/app/api/state/route");

function post(id: number): Post {
  return {
    id,
    preview_url: "p",
    sample_url: "s",
    file_url: "f",
    width: 1,
    height: 1,
    sample_width: 1,
    sample_height: 1,
    rating: "safe",
    score: 0,
    tags: "a b",
    owner: "o",
    change: 0,
    comment_count: 0,
  };
}

function get(url: string) {
  return GET(new NextRequest(new Request(`http://localhost${url}`)));
}

function mutate(body: unknown) {
  return POST(
    new NextRequest(
      new Request("http://localhost/api/state", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/state", () => {
  it("returns the light snapshot by default", async () => {
    const snapshot = {
      likes: [],
      dismissed: [],
      seen: [],
      seeds: [],
      blocked: [],
    };
    store.readSnapshot.mockReturnValue(snapshot);

    const res = await get("/api/state");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(snapshot);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(store.readLikePosts).not.toHaveBeenCalled();
  });

  it("returns the liked posts and the tag metadata on request", async () => {
    store.readLikePosts.mockReturnValue([post(1)]);
    store.readTagMeta.mockReturnValue([["a", 5, "artist"]]);

    expect(await (await get("/api/state?part=likePosts")).json()).toEqual([
      post(1),
    ]);
    expect(await (await get("/api/state?part=tagMeta")).json()).toEqual([
      ["a", 5, "artist"],
    ]);
  });

  it("reports a broken database as a server error", async () => {
    store.readSnapshot.mockImplementation(() => {
      throw new Error("no disk");
    });

    const res = await get("/api/state");

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "state unavailable" });
  });
});

describe("POST /api/state", () => {
  it("toggles a like and answers with the stored list", async () => {
    store.toggleLike.mockReturnValue([{ id: 1 }]);

    const res = await mutate({ action: "toggleLike", post: post(1) });

    expect(store.toggleLike).toHaveBeenCalledWith(expect.anything(), post(1));
    expect(await res.json()).toEqual([{ id: 1 }]);
  });

  it("passes each of the other mutations through", async () => {
    store.dismiss.mockReturnValue([]);
    store.undismiss.mockReturnValue([]);
    store.clearDismissed.mockReturnValue([]);
    store.setSeeds.mockReturnValue(["a"]);
    store.setBlockedTags.mockReturnValue(["b"]);

    await mutate({ action: "dismiss", post: post(2) });
    await mutate({ action: "undismiss", id: 2 });
    await mutate({ action: "clearDismissed" });
    await mutate({ action: "recordSeen", ids: [1, 2] });
    await mutate({ action: "setSeeds", tags: ["a"] });
    await mutate({ action: "setBlockedTags", tags: ["b"] });
    await mutate({
      action: "recordTagInfo",
      entries: [{ tag: "a", count: 1, type: "tag" }],
    });

    expect(store.dismiss).toHaveBeenCalledWith(expect.anything(), post(2));
    expect(store.undismiss).toHaveBeenCalledWith(expect.anything(), 2);
    expect(store.clearDismissed).toHaveBeenCalled();
    expect(store.recordSeen).toHaveBeenCalledWith(expect.anything(), [1, 2]);
    expect(store.setSeeds).toHaveBeenCalledWith(expect.anything(), ["a"]);
    expect(store.setBlockedTags).toHaveBeenCalledWith(expect.anything(), ["b"]);
    expect(store.recordTagInfo).toHaveBeenCalledWith(expect.anything(), [
      { tag: "a", count: 1, type: "tag" },
    ]);
  });

  it("rejects a malformed body without touching the store", async () => {
    expect((await mutate("not json")).status).toBe(400);
    expect((await mutate({ action: "nope" })).status).toBe(400);
    expect((await mutate({ action: "toggleLike", post: { id: 1 } })).status).toBe(
      400,
    );
    expect((await mutate({ action: "undismiss", id: "one" })).status).toBe(400);

    expect(store.toggleLike).not.toHaveBeenCalled();
    expect(store.undismiss).not.toHaveBeenCalled();
  });

  it("reports a failing write as a server error", async () => {
    store.toggleLike.mockImplementation(() => {
      throw new Error("locked");
    });

    const res = await mutate({ action: "toggleLike", post: post(1) });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "state unavailable" });
  });
});
