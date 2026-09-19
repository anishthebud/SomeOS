import { NextResponse } from "next/server";

import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { saveFinderUpload } from "@/lib/fileops";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const form = await req.formData();
    const parent = String(form.get("parent") || "sources");
    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (!files.length) return NextResponse.json({ error: "Choose at least one file" }, { status: 400 });
    const uploaded = [];
    for (const file of files.slice(0, 50)) uploaded.push(await saveFinderUpload(parent, file));
    return NextResponse.json({ uploaded }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
