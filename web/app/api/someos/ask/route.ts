import { NextResponse } from "next/server";
import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { answerFromFilesystem } from "@/lib/someos";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const body = (await req.json()) as { question?: string };
    if (!body.question?.trim()) return NextResponse.json({ error: "question is required" }, { status: 400 });
    return NextResponse.json(await answerFromFilesystem(body.question.trim()));
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 500 }); }
}
