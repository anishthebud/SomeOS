import { NextResponse } from "next/server";
import { answerFromFilesystem } from "@/lib/someos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const expected = process.env.IOT_INGEST_KEY;
  const presented = req.headers.get("x-someos-key") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || presented !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const body = (await req.json()) as { device_id?: string; room?: string; text?: string; ts?: string };
    if (!body.device_id?.trim()) return NextResponse.json({ error: "device_id is required" }, { status: 400 });
    if (!body.text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });

    const result = await answerFromFilesystem(body.text.trim());
    return NextResponse.json({
      ...result,
      device_id: body.device_id,
      room: body.room || "unknown",
      received_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
