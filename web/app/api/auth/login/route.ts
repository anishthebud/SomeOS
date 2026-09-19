import { NextResponse } from "next/server";
import {
  authEnabled,
  checkPassword,
  clearFailures,
  clientIp,
  noteFailure,
  rateLimited,
  sessionCookie,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST { password } → set the session cookie.
export async function POST(req: Request) {
  if (!authEnabled()) {
    // No APP_PASSWORD configured: the app is open, so "logging in" is a no-op.
    return NextResponse.json({ ok: true, enabled: false });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  let password: unknown;
  try {
    ({ password } = (await req.json()) as { password?: unknown });
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  if (!checkPassword(password)) {
    noteFailure(ip);
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  clearFailures(ip);
  return NextResponse.json(
    { ok: true, enabled: true },
    { headers: { "Set-Cookie": sessionCookie(), "Cache-Control": "no-store" } },
  );
}
