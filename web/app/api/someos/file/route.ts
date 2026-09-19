import { NextResponse } from "next/server";
import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { readVaultText, writeVaultText } from "@/lib/someos";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try { return NextResponse.json(await readVaultText(new URL(req.url).searchParams.get("path") || ""), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
export async function PUT(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const body = (await req.json()) as { path?: string; content?: string };
    if (!body.path || typeof body.content !== "string") return NextResponse.json({ error: "path and content are required" }, { status: 400 });
    return NextResponse.json(await writeVaultText(body.path, body.content));
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
