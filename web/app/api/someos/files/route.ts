import { NextResponse } from "next/server";

import { privateApiAuthorized, unauthorized } from "@/lib/apiauth";
import {
  createFinderFile,
  createFinderFolder,
  deleteFinderItemPermanently,
  duplicateFinderItem,
  listFinderDirectory,
  moveFinderItem,
  renameFinderItem,
  restoreFinderItem,
  trashFinderItem,
} from "@/lib/fileops";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const relative = new URL(req.url).searchParams.get("path") || "sources";
    return NextResponse.json(await listFinderDirectory(relative), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}

export async function POST(req: Request) {
  if (!privateApiAuthorized(req)) return NextResponse.json(unauthorized(), { status: 401 });
  try {
    const body = (await req.json()) as { action?: string; parent?: string; source?: string; destination?: string; name?: string };
    switch (body.action) {
      case "new-folder": return NextResponse.json(await createFinderFolder(body.parent || "sources", body.name || "Untitled Folder"), { status: 201 });
      case "new-file": return NextResponse.json(await createFinderFile(body.parent || "sources", body.name || "Untitled.md"), { status: 201 });
      case "rename": return NextResponse.json(await renameFinderItem(body.source || "", body.name || ""));
      case "move": return NextResponse.json(await moveFinderItem(body.source || "", body.destination || ""));
      case "duplicate": return NextResponse.json(await duplicateFinderItem(body.source || ""), { status: 201 });
      case "trash": return NextResponse.json(await trashFinderItem(body.source || ""));
      case "restore": return NextResponse.json(await restoreFinderItem(body.source || ""));
      case "delete": return NextResponse.json(await deleteFinderItemPermanently(body.source || ""));
      default: return NextResponse.json({ error: "Unknown file action" }, { status: 400 });
    }
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }); }
}
