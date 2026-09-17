import { NextRequest, NextResponse } from "next/server";
import { buildExport, hasBackupContent, normalizeBackup } from "@/lib/backup";
import { getDb } from "@/lib/db";
import * as store from "@/lib/store";

/**
 * Export and import of the persisted state as one JSON file.
 *
 * The file carries likes (with their posts), dismissals, seed and blocked
 * tags. Seen ids and tag metadata are caches that rebuild themselves, so they
 * are neither exported nor touched by an import. An import always replaces —
 * no merge — and answers with what the store actually kept after its caps
 * and the blocked-tag rules ran.
 */

const HEADERS = { "Cache-Control": "private, no-store" };

/** A full export is ~1–2 MB; anything far past that isn't one of ours. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export async function GET() {
  try {
    const envelope = buildExport(store.readExport(getDb()));
    const date = envelope.exportedAt.slice(0, 10);
    return NextResponse.json(envelope, {
      headers: {
        ...HEADERS,
        "Content-Disposition": `attachment; filename="r34-browser-${date}.json"`,
      },
    });
  } catch (err) {
    console.error("backup export failed:", err);
    return NextResponse.json({ error: "state unavailable" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get("content-length"));
  if (declared > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "too large" }, { status: 413 });
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  // The header can be missing or lie; the body can't.
  if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  // Unrelated JSON must never wipe the store — the file has to name at least
  // one of the fields an import restores.
  const normalized = normalizeBackup(body);
  if (!normalized || !hasBackupContent(normalized.present)) {
    return NextResponse.json(
      { error: "nothing recognisable" },
      { status: 422 },
    );
  }
  const { likes, dismissed, seeds, blocked } = normalized.backup;

  try {
    const db = getDb();
    store.replaceSnapshot(db, { likes, dismissed, seeds, blocked });
    const stored = store.readExport(db);
    return NextResponse.json(
      {
        likes: stored.likes.length,
        dismissed: stored.dismissed.length,
        seeds: stored.seeds.length,
        blocked: stored.blocked.length,
      },
      { headers: HEADERS },
    );
  } catch (err) {
    console.error("backup import failed:", err);
    return NextResponse.json({ error: "state unavailable" }, { status: 500 });
  }
}
