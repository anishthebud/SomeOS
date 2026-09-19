import { NextResponse } from "next/server";
import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { createTask, listTasks, updateTask } from "@/lib/someos";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  return NextResponse.json({ tasks: await listTasks() }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const body = await req.json();
    if (!String(body?.title || "").trim()) return NextResponse.json({ error: "title is required" }, { status: 400 });
    return NextResponse.json(await createTask(body), { status: 201 });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
export async function PATCH(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const body = (await req.json()) as { id?: string; patch?: Record<string, unknown> };
    if (!body.id || !body.patch) return NextResponse.json({ error: "id and patch are required" }, { status: 400 });
    return NextResponse.json(await updateTask(body.id, body.patch));
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
