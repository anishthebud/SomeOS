import { NextResponse } from "next/server";
import { authEnabled, hasSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

// GET → is login required on this deployment, and is this browser signed in?
export async function GET(req: Request) {
  return NextResponse.json(
    { enabled: authEnabled(), authed: hasSession(req) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
