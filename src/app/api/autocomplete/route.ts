import { NextRequest, NextResponse } from "next/server";
import { fetchAutocomplete } from "@/lib/r34";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json([]);

  try {
    const entries = await fetchAutocomplete(q);
    return NextResponse.json(entries, {
      headers: { "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    console.error("autocomplete proxy failed:", err);
    return NextResponse.json({ error: "upstream request failed" }, { status: 502 });
  }
}
