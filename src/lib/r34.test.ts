import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAutocomplete, fetchPosts, UpstreamError } from "@/lib/r34";
import { PAGE_SIZE } from "@/lib/types";

const rawPost = {
  id: 1,
  preview_url: "p",
  sample_url: "s",
  file_url: "f",
  width: 100,
  height: 200,
  sample_width: 50,
  sample_height: 100,
  rating: "explicit",
  score: 3,
  tags: "a b",
  owner: "o",
  change: 1,
};

function mockFetch(body: string, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (): Promise<unknown> => ({ ok, status, text: async () => body })),
  );
}

/** The arguments of the last fetch call. */
function lastCall(): [url: URL, init?: RequestInit] {
  const call = vi.mocked(globalThis.fetch).mock.calls.at(-1)!;
  return [new URL(String(call[0])), call[1] as RequestInit | undefined];
}

function calledUrl(): URL {
  return lastCall()[0];
}

beforeEach(() => {
  vi.stubEnv("API_KEY", "test-key");
  vi.stubEnv("USER_ID", "test-user");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("fetchPosts", () => {
  it("sends the documented dapi parameters and the credentials", async () => {
    mockFetch(JSON.stringify([rawPost]));
    await fetchPosts("miku", 2);
    const url = calledUrl();
    expect(url.origin + url.pathname).toBe("https://api.rule34.xxx/index.php");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      page: "dapi",
      s: "post",
      q: "index",
      json: "1",
      pid: "2",
      tags: "miku",
      api_key: "test-key",
      user_id: "test-user",
    });
  });

  it("refuses to run without credentials", async () => {
    vi.stubEnv("API_KEY", "");
    mockFetch("[]");
    await expect(fetchPosts("miku", 0)).rejects.toThrow(/API_KEY/);
  });

  it("clamps the limit into the API's allowed range", async () => {
    mockFetch(JSON.stringify([]));
    await fetchPosts("a", 0, 5000);
    expect(calledUrl().searchParams.get("limit")).toBe(String(PAGE_SIZE));
    await fetchPosts("a", 0, -3);
    expect(calledUrl().searchParams.get("limit")).toBe("1");
  });

  it("only asks for tag_info when told to — it costs ~2.5KB per post", async () => {
    mockFetch(JSON.stringify([]));
    await fetchPosts("a", 0);
    expect(calledUrl().searchParams.has("fields")).toBe(false);
    await fetchPosts("a", 0, 1, true);
    expect(calledUrl().searchParams.get("fields")).toBe("tag_info");
  });

  it("treats the API's empty body for zero results as an empty list", async () => {
    mockFetch("");
    await expect(fetchPosts("nothing", 0)).resolves.toEqual([]);
    mockFetch("   ");
    await expect(fetchPosts("nothing", 0)).resolves.toEqual([]);
  });

  it("treats a non-array body as no results rather than throwing", async () => {
    mockFetch('{"error":"nope"}');
    await expect(fetchPosts("a", 0)).resolves.toEqual([]);
  });

  it("parses posts and defaults the optional comment count", async () => {
    mockFetch(JSON.stringify([rawPost]));
    const posts = await fetchPosts("a", 0);
    expect(posts[0].id).toBe(1);
    expect(posts[0].comment_count).toBe(0);
  });

  it("drops a malformed post instead of failing the whole page", async () => {
    mockFetch(JSON.stringify([{ ...rawPost, id: "one" }, rawPost]));
    const posts = await fetchPosts("a", 0);
    expect(posts.map((p) => p.id)).toEqual([1]);
  });

  it("bounds how long it waits for the upstream", async () => {
    mockFetch(JSON.stringify([rawPost]));
    await fetchPosts("a", 0);
    expect(lastCall()[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("surfaces an upstream failure with its status", async () => {
    mockFetch("", false, 503);
    await expect(fetchPosts("a", 0)).rejects.toThrow(/503/);
    mockFetch("", false, 429);
    await expect(fetchPosts("a", 0)).rejects.toBeInstanceOf(UpstreamError);
    mockFetch("", false, 429);
    await expect(fetchPosts("a", 0)).rejects.toMatchObject({ status: 429 });
  });
});

describe("fetchAutocomplete", () => {
  it("sends the referer the endpoint insists on", async () => {
    mockFetch(JSON.stringify([]));
    await fetchAutocomplete("mik");
    const [url, init] = lastCall();
    expect(String(url)).toContain("autocomplete.php?q=mik");
    expect((init?.headers as Record<string, string>).Referer).toBe(
      "https://rule34.xxx/",
    );
  });

  it("parses suggestions and tolerates an empty body", async () => {
    mockFetch(JSON.stringify([{ label: "miku (40060)", value: "miku" }]));
    await expect(fetchAutocomplete("mik")).resolves.toEqual([
      { label: "miku (40060)", value: "miku" },
    ]);
    mockFetch("");
    await expect(fetchAutocomplete("mik")).resolves.toEqual([]);
  });

  it("surfaces an upstream failure", async () => {
    mockFetch("", false, 500);
    await expect(fetchAutocomplete("mik")).rejects.toThrow(/500/);
  });
});
