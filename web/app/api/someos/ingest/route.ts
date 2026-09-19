import { NextResponse } from "next/server";
import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { ingestSources } from "@/lib/someos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const body = (await req.json().catch(() => ({}))) as { limit?: number };
    return NextResponse.json(await ingestSources(Number(body.limit) || 8));
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 500 }); }
}
