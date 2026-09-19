import { NextResponse } from "next/server";
import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { searchFilesystem } from "@/lib/someos";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  const query = new URL(req.url).searchParams.get("q")?.trim() || "";
  try { return NextResponse.json({ hits: query ? await searchFilesystem(query) : [] }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 500 }); }
}
