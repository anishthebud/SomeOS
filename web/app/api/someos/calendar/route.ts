import { NextResponse } from "next/server";
import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { createCalendarEvent, listCalendarEventsPage } from "@/lib/someos";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  const params = new URL(req.url).searchParams;
  const on = params.get("on") || undefined;
  const page = await listCalendarEventsPage({
    limit: Number(params.get("limit")) || undefined,
    offset: Number(params.get("offset")) || undefined,
    on: on && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : undefined,
  });
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const body = await req.json();
    if (!String(body?.title || "").trim() || !String(body?.date || "").trim()) return NextResponse.json({ error: "title and date are required" }, { status: 400 });
    return NextResponse.json(await createCalendarEvent(body), { status: 201 });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
