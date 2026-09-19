import { NextResponse } from "next/server";
import { captureSource } from "@/lib/someos";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const expected = process.env.IOT_INGEST_KEY;
  const presented = req.headers.get("x-someos-key") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || presented !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await req.json()) as { device_id?: string; title?: string; content?: string; data?: unknown };
    if (!body.device_id) return NextResponse.json({ error: "device_id is required" }, { status: 400 });
    const content = body.content?.trim() || (body.data === undefined ? "" : JSON.stringify(body.data, null, 2));
    if (!content) return NextResponse.json({ error: "content or data is required" }, { status: 400 });
    const capture = await captureSource({ title: body.title, content, deviceId: body.device_id });
    return NextResponse.json({ ok: true, ...capture }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
