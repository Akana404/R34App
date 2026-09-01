import { NextRequest, NextResponse } from "next/server";
import { fetchPosts, NotConfiguredError, UpstreamError } from "@/lib/r34";
import { PAGE_SIZE } from "@/lib/types";

/** The API rejects very long queries; nothing legitimate comes close. */
const MAX_TAGS_LENGTH = 1500;
const MAX_PAGE = 10_000;

export async function GET(req: NextRequest) {
  const tags = req.nextUrl.searchParams.get("tags") ?? "";
  if (tags.length > MAX_TAGS_LENGTH) {
    return NextResponse.json({ error: "query too long" }, { status: 400 });
  }
  const page = Math.min(
    MAX_PAGE,
    Math.max(0, Number(req.nextUrl.searchParams.get("page")) || 0),
  );
  const limit = Number(req.nextUrl.searchParams.get("limit")) || PAGE_SIZE;
  const tagInfo = req.nextUrl.searchParams.get("tagInfo") === "1";

  try {
    const posts = await fetchPosts(tags, page, limit, tagInfo);
    return NextResponse.json(posts, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    console.error("posts proxy failed:", err);
    // Pass rate limiting through as itself: the client backs off instead of
    // telling the user the API is down.
    if (err instanceof UpstreamError && err.status === 429) {
      return NextResponse.json({ error: "rate limited" }, { status: 429 });
    }
    // Missing credentials get their own status so the UI can explain the
    // setup instead of blaming the API. (Upstream 503s arrive as 502.)
    if (err instanceof NotConfiguredError) {
      return NextResponse.json({ error: "not configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "upstream request failed" }, { status: 502 });
  }
}
