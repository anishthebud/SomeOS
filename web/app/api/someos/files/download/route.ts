import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { resolveVaultPath } from "@/lib/someos";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const relative = new URL(req.url).searchParams.get("path") || "";
    const resolved = resolveVaultPath(relative);
    const stat = await fs.stat(resolved.full);
    if (!stat.isFile()) return NextResponse.json({ error: "Only files can be downloaded" }, { status: 400 });
    const data = await fs.readFile(resolved.full);
    return new Response(data, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(relative))}`,
        "Content-Length": String(data.byteLength),
      },
    });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
