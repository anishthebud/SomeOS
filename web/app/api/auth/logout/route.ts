import { NextResponse } from "next/server";
import { clearedCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST → drop the session cookie.
export async function POST() {
  return NextResponse.json(
    { ok: true },
    { headers: { "Set-Cookie": clearedCookie(), "Cache-Control": "no-store" } },
  );
}
