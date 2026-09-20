import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import { MEDIA_TYPES, resolveVaultPath } from "@/lib/someos";

export const dynamic = "force-dynamic";

// Streams a vault file inline with HTTP Range support so <video>/<audio> can seek.
export async function GET(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const resolved = resolveVaultPath(new URL(req.url).searchParams.get("path") || "");
    const type = MEDIA_TYPES[path.extname(resolved.full).toLowerCase()];
    if (!type) return NextResponse.json({ error: "Inline preview is not available for this file type" }, { status: 415 });
    const stat = await fs.stat(resolved.full);
    if (!stat.isFile()) return NextResponse.json({ error: "Not a file" }, { status: 400 });

    const headers: Record<string, string> = {
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // SVG can carry scripts; sandbox it if someone opens the URL directly.
      ...(type === "image/svg+xml" ? { "Content-Security-Policy": "sandbox" } : {}),
    };
    const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
    let start = 0;
    let end = stat.size - 1;
    let status = 200;
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), end);
      } else {
        start = Math.max(0, stat.size - Number(range[2]));
      }
      if (start > end || start >= stat.size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers["Content-Length"] = String(stat.size === 0 ? 0 : end - start + 1);
    const body = stat.size === 0 ? null : (Readable.toWeb(createReadStream(resolved.full, { start, end })) as ReadableStream);
    return new Response(body, { status, headers });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
