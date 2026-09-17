import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDb = vi.fn(() => ({}) as never);
vi.mock("@/lib/db", () => ({ getDb: () => getDb() }));

const store = {
  readExport: vi.fn(),
  replaceSnapshot: vi.fn(),
};
vi.mock("@/lib/store", () => store);

const { GET, POST, MAX_IMPORT_BYTES } = await import("@/app/api/backup/route");

const EMPTY = { likes: [], dismissed: [], seeds: [], blocked: [] };

function upload(body: string) {
  return POST(
    new NextRequest(
      new Request("http://localhost/api/backup", { method: "POST", body }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  store.readExport.mockReset();
  store.replaceSnapshot.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/backup", () => {
  it("downloads the export as a dated attachment", async () => {
    store.readExport.mockReturnValue({ ...EMPTY, seeds: ["s"] });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="r34-browser-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(await res.json()).toMatchObject({
      app: "r34-browser",
      version: 2,
      data: { ...EMPTY, seeds: ["s"] },
    });
  });

  it("reports a broken database as a server error", async () => {
    store.readExport.mockImplementation(() => {
      throw new Error("no disk");
    });

    expect((await GET()).status).toBe(500);
  });
});

describe("POST /api/backup", () => {
  it("replaces the store without the caches and answers with what was kept", async () => {
    store.readExport.mockReturnValue({
      likes: [{ id: 1 }],
      dismissed: [],
      seeds: ["s"],
      blocked: [],
    });

    const res = await upload(
      JSON.stringify({
        app: "r34-browser",
        version: 2,
        data: {
          likes: [{ id: 1, tags: ["a"], score: 0, rating: "safe", likedAt: 1 }],
          dismissed: [],
          seeds: ["s"],
          blocked: [],
          seen: [1, 2, 3],
          tagMeta: [["a", 1, "tag"]],
        },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ likes: 1, dismissed: 0, seeds: 1, blocked: 0 });
    const [, snapshot] = store.replaceSnapshot.mock.calls[0];
    expect(Object.keys(snapshot).sort()).toEqual([
      "blocked",
      "dismissed",
      "likes",
      "seeds",
    ]);
  });

  it("rejects invalid JSON", async () => {
    expect((await upload("{nope")).status).toBe(400);
    expect(store.replaceSnapshot).not.toHaveBeenCalled();
  });

  it("rejects an oversized body", async () => {
    const res = await upload(`"${"x".repeat(MAX_IMPORT_BYTES)}"`);
    expect(res.status).toBe(413);
    expect(store.replaceSnapshot).not.toHaveBeenCalled();
  });

  it("refuses unrelated JSON rather than wiping the store", async () => {
    for (const body of ['{"hello":"world"}', "[1,2]", '{"forYou:seen":[1]}']) {
      expect((await upload(body)).status).toBe(422);
    }
    expect(store.replaceSnapshot).not.toHaveBeenCalled();
  });

  it("reports a failed write as a server error", async () => {
    store.replaceSnapshot.mockImplementation(() => {
      throw new Error("disk full");
    });

    expect((await upload(JSON.stringify({ data: EMPTY }))).status).toBe(500);
  });
});
