import { NextResponse } from "next/server";
import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { getSnapshot } from "@/lib/someos";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try { return NextResponse.json(await getSnapshot(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 500 }); }
}
