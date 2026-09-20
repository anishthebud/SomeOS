import { NextResponse } from "next/server";
import { answerFromFilesystem } from "@/lib/someos";
import { withDeviceConversation } from "@/lib/iot-conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const expected = process.env.IOT_INGEST_KEY;
  const presented = req.headers.get("x-someos-key") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || presented !== expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    const value: unknown = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid body");
    body = value as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "a JSON object is required" }, { status: 400 });
  }
  const deviceId = typeof body.device_id === "string" ? body.device_id.trim() : "";
  const question = typeof body.text === "string" ? body.text.trim() : "";
  if (!deviceId || deviceId.length > 128) return NextResponse.json({ error: "device_id must contain 1–128 characters" }, { status: 400 });
  if (!question || question.length > 8000) return NextResponse.json({ error: "text must contain 1–8000 characters" }, { status: 400 });
  if (body.session_id !== undefined && (typeof body.session_id !== "string" || !body.session_id.trim() || body.session_id.length > 128)) {
    return NextResponse.json({ error: "session_id must contain 1–128 characters" }, { status: 400 });
  }
  if (body.reset_memory !== undefined && typeof body.reset_memory !== "boolean") {
    return NextResponse.json({ error: "reset_memory must be a boolean" }, { status: 400 });
  }
  if (body.room !== undefined && (typeof body.room !== "string" || body.room.length > 128)) {
    return NextResponse.json({ error: "room must be a string of at most 128 characters" }, { status: 400 });
  }
  try {
    const result = await withDeviceConversation({
      deviceId,
      sessionId: typeof body.session_id === "string" ? body.session_id.trim() : undefined,
      question,
      reset: body.reset_memory === true,
    }, (history) => answerFromFilesystem(question, history));
    return NextResponse.json({
      ...result,
      device_id: deviceId,
      room: body.room || "unknown",
      received_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
