import { NextResponse } from "next/server";
import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { captureSource } from "@/lib/someos";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const body = (await req.json()) as { title?: string; content?: string; kind?: string };
    if (!body.content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });
    return NextResponse.json(await captureSource(body as { title?: string; content: string; kind?: string }), { status: 201 });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
