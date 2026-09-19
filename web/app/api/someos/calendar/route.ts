import { NextResponse } from "next/server";
import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { createCalendarEvent, listCalendarEvents } from "@/lib/someos";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  return NextResponse.json({ events: await listCalendarEvents() }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const body = await req.json();
    if (!String(body?.title || "").trim() || !String(body?.date || "").trim()) return NextResponse.json({ error: "title and date are required" }, { status: 400 });
    return NextResponse.json(await createCalendarEvent(body), { status: 201 });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
