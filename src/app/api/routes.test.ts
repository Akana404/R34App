import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPosts = vi.fn();
const fetchAutocomplete = vi.fn();
class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`rule34 API responded with ${status}`);
  }
}
class NotConfiguredError extends Error {}
vi.mock("@/lib/r34", () => ({
  fetchPosts: (...args: unknown[]) => fetchPosts(...args),
  fetchAutocomplete: (...args: unknown[]) => fetchAutocomplete(...args),
  UpstreamError,
  NotConfiguredError,
}));

const { GET: getPosts } = await import("@/app/api/posts/route");
const { GET: getAutocomplete } = await import("@/app/api/autocomplete/route");

function request(url: string) {
  return new NextRequest(new Request(`http://localhost${url}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/posts", () => {
  it("passes the search through and caches the response privately", async () => {
    fetchPosts.mockResolvedValue([{ id: 1 }]);
    const res = await getPosts(request("/api/posts?tags=miku&page=2&limit=25"));
    expect(fetchPosts).toHaveBeenCalledWith("miku", 2, 25, false);
    expect(await res.json()).toEqual([{ id: 1 }]);
    // The response carries the user's API key upstream — never a shared cache.
    expect(res.headers.get("Cache-Control")).toContain("private");
  });

  it("defaults to the first page and the full page size", async () => {
    fetchPosts.mockResolvedValue([]);
    await getPosts(request("/api/posts"));
    expect(fetchPosts).toHaveBeenCalledWith("", 0, 100, false);
  });

  it("never asks upstream for a negative page", async () => {
    fetchPosts.mockResolvedValue([]);
    await getPosts(request("/api/posts?tags=a&page=-5"));
    expect(fetchPosts).toHaveBeenCalledWith("a", 0, 100, false);
  });

  it("refuses a query longer than the API could accept", async () => {
    const res = await getPosts(
      request(`/api/posts?tags=${"a".repeat(1600)}`),
    );
    expect(res.status).toBe(400);
    expect(fetchPosts).not.toHaveBeenCalled();
  });

  it("clamps an absurd page number instead of forwarding it", async () => {
    fetchPosts.mockResolvedValue([]);
    await getPosts(request("/api/posts?tags=a&page=999999999"));
    expect(fetchPosts).toHaveBeenCalledWith("a", 10_000, 100, false);
  });

  it("requests tag_info only when asked", async () => {
    fetchPosts.mockResolvedValue([]);
    await getPosts(request("/api/posts?tags=a&tagInfo=1"));
    expect(fetchPosts).toHaveBeenLastCalledWith("a", 0, 100, true);
    await getPosts(request("/api/posts?tags=a&tagInfo=yes"));
    expect(fetchPosts).toHaveBeenLastCalledWith("a", 0, 100, false);
  });

  it("passes rate limiting through as 429 so the client can back off", async () => {
    fetchPosts.mockRejectedValue(new UpstreamError(429));
    const res = await getPosts(request("/api/posts?tags=a"));
    expect(res.status).toBe(429);
  });

  it("still reports other upstream statuses as 502", async () => {
    fetchPosts.mockRejectedValue(new UpstreamError(503));
    expect((await getPosts(request("/api/posts?tags=a"))).status).toBe(502);
  });

  it("answers 503 when the server is missing its credentials", async () => {
    fetchPosts.mockRejectedValue(new NotConfiguredError());
    const res = await getPosts(request("/api/posts?tags=a"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "not configured" });
  });

  it("keeps an upstream 503 a 502, distinct from missing credentials", async () => {
    fetchPosts.mockRejectedValue(new UpstreamError(503));
    expect((await getPosts(request("/api/posts?tags=a"))).status).toBe(502);
  });

  it("turns an upstream failure into a 502 without leaking the reason", async () => {
    fetchPosts.mockRejectedValue(new Error("API_KEY and USER_ID must be set"));
    const res = await getPosts(request("/api/posts?tags=a"));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("API_KEY");
  });
});

describe("GET /api/autocomplete", () => {
  it("returns suggestions for a query", async () => {
    fetchAutocomplete.mockResolvedValue([{ label: "miku (5)", value: "miku" }]);
    const res = await getAutocomplete(request("/api/autocomplete?q=mik"));
    expect(fetchAutocomplete).toHaveBeenCalledWith("mik");
    expect(await res.json()).toHaveLength(1);
  });

  it("answers an empty or blank query without calling upstream", async () => {
    for (const url of ["/api/autocomplete", "/api/autocomplete?q=%20%20"]) {
      const res = await getAutocomplete(request(url));
      expect(await res.json()).toEqual([]);
    }
    expect(fetchAutocomplete).not.toHaveBeenCalled();
  });

  it("trims the query, so ' miku ' hits the same cache entry as 'miku'", async () => {
    fetchAutocomplete.mockResolvedValue([]);
    await getAutocomplete(request("/api/autocomplete?q=%20miku%20"));
    expect(fetchAutocomplete).toHaveBeenCalledWith("miku");
  });

  it("turns an upstream failure into a 502", async () => {
    fetchAutocomplete.mockRejectedValue(new Error("boom"));
    const res = await getAutocomplete(request("/api/autocomplete?q=mik"));
    expect(res.status).toBe(502);
  });
});
