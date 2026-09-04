import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import * as store from "@/lib/store";
import { postSchema, tagInfoSchema } from "@/lib/types";

/**
 * The persisted app state: likes, dismissals, seen posts, seed and blocked
 * tags, tag metadata. No auth and no user column — one dataset per server.
 *
 * Every mutation answers with the authoritative slice it changed, so the
 * client can reconcile the optimistic update it already painted with what
 * the store actually kept after its caps ran.
 */

// Live, mutable state — unlike /api/posts this must never be cached.
const HEADERS = { "Cache-Control": "private, no-store" };

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("toggleLike"), post: postSchema }),
  z.object({ action: z.literal("dismiss"), post: postSchema }),
  z.object({ action: z.literal("undismiss"), id: z.number() }),
  z.object({ action: z.literal("clearDismissed") }),
  z.object({ action: z.literal("recordSeen"), ids: z.array(z.number()).max(500) }),
  z.object({ action: z.literal("setSeeds"), tags: z.array(z.string()).max(100) }),
  z.object({
    action: z.literal("setBlockedTags"),
    tags: z.array(z.string()).max(100),
  }),
  z.object({
    action: z.literal("recordTagInfo"),
    entries: z.array(tagInfoSchema).max(500),
  }),
]);

export async function GET(req: NextRequest) {
  const part = req.nextUrl.searchParams.get("part");
  try {
    const db = getDb();
    // The post blobs and the tag metadata dwarf the rest of the state, and
    // only one view each needs them — they are asked for separately.
    if (part === "likePosts") {
      return NextResponse.json(store.readLikePosts(db), { headers: HEADERS });
    }
    if (part === "tagMeta") {
      return NextResponse.json(store.readTagMeta(db), { headers: HEADERS });
    }
    return NextResponse.json(store.readSnapshot(db), { headers: HEADERS });
  } catch (err) {
    console.error("state read failed:", err);
    return NextResponse.json({ error: "state unavailable" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const parsed = mutationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid mutation" }, { status: 400 });
  }
  const mutation = parsed.data;

  try {
    const db = getDb();
    switch (mutation.action) {
      case "toggleLike":
        return NextResponse.json(store.toggleLike(db, mutation.post), {
          headers: HEADERS,
        });
      case "dismiss":
        return NextResponse.json(store.dismiss(db, mutation.post), {
          headers: HEADERS,
        });
      case "undismiss":
        return NextResponse.json(store.undismiss(db, mutation.id), {
          headers: HEADERS,
        });
      case "clearDismissed":
        return NextResponse.json(store.clearDismissed(db), { headers: HEADERS });
      case "recordSeen":
        store.recordSeen(db, mutation.ids);
        return NextResponse.json({ ok: true }, { headers: HEADERS });
      case "setSeeds":
        return NextResponse.json(store.setSeeds(db, mutation.tags), {
          headers: HEADERS,
        });
      case "setBlockedTags":
        return NextResponse.json(store.setBlockedTags(db, mutation.tags), {
          headers: HEADERS,
        });
      case "recordTagInfo":
        store.recordTagInfo(db, mutation.entries);
        return NextResponse.json({ ok: true }, { headers: HEADERS });
    }
  } catch (err) {
    console.error("state mutation failed:", err);
    return NextResponse.json({ error: "state unavailable" }, { status: 500 });
  }
}
