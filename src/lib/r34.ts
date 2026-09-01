import {
  PAGE_SIZE,
  postSchema,
  autocompleteEntrySchema,
  type Post,
  type AutocompleteEntry,
} from "./types";

/** An upstream failure, carrying the status so callers can tell 429 apart. */
export class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`rule34 API responded with ${status}`);
    this.name = "UpstreamError";
  }
}

/**
 * Missing credentials — kept apart from upstream failures so the UI can say
 * "set up your .env" instead of "the API may be down".
 */
export class NotConfiguredError extends Error {
  constructor() {
    super("API_KEY and USER_ID must be set in .env");
    this.name = "NotConfiguredError";
  }
}

const POSTS_URL = "https://api.rule34.xxx/index.php";
const AUTOCOMPLETE_URL = "https://api.rule34.xxx/autocomplete.php";

/** A hung upstream response must not tie the route handler up forever. */
const TIMEOUT_MS = 10_000;

function authParams(): Record<string, string> {
  const { API_KEY, USER_ID } = process.env;
  if (!API_KEY || !USER_ID) {
    throw new NotConfiguredError();
  }
  return { api_key: API_KEY, user_id: USER_ID };
}

export async function fetchPosts(
  tags: string,
  page: number,
  limit: number = PAGE_SIZE,
  /** Ask for per-tag category and global count; ~2.5KB extra per post. */
  includeTagInfo = false,
): Promise<Post[]> {
  const url = new URL(POSTS_URL);
  const params: Record<string, string> = {
    page: "dapi",
    s: "post",
    q: "index",
    json: "1",
    limit: String(Math.min(Math.max(1, Math.floor(limit)), PAGE_SIZE)),
    pid: String(page),
    tags,
    ...(includeTagInfo ? { fields: "tag_info" } : {}),
    ...authParams(),
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new UpstreamError(res.status);

  // The API returns an empty body (or non-array) instead of [] for zero results.
  const text = await res.text();
  if (!text.trim()) return [];
  const data = JSON.parse(text);
  if (!Array.isArray(data)) return [];
  // Validate per post: one malformed record drops that post, not the page.
  return data.flatMap((item) => {
    const parsed = postSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function fetchAutocomplete(query: string): Promise<AutocompleteEntry[]> {
  const url = new URL(AUTOCOMPLETE_URL);
  url.searchParams.set("q", query);

  const res = await fetch(url, {
    next: { revalidate: 3600 },
    // The autocomplete endpoint rejects requests without a browser-like referer.
    headers: { Referer: "https://rule34.xxx/" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new UpstreamError(res.status);

  const text = await res.text();
  if (!text.trim()) return [];
  const data = JSON.parse(text);
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const parsed = autocompleteEntrySchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}
