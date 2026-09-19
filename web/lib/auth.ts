// Password login for the deployment. SERVER-ONLY (imports node:crypto).
//
// Set APP_PASSWORD to turn login on. Leave it unset and the app stays open —
// which is the right default for a local clone or a private demo.
//
// The session is stateless: the cookie holds an HMAC of a fixed string keyed by
// APP_PASSWORD, so there is no session store to run and rotating the password
// invalidates every existing session. The cookie is httpOnly, so page scripts
// cannot read it.
import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "cortex_session";
const SESSION_PAYLOAD = "cortex-session-v1";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

function expectedToken(): string {
  return createHmac("sha256", process.env.APP_PASSWORD || "")
    .update(SESSION_PAYLOAD)
    .digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Does this request carry a valid session? (True when auth is disabled.) */
export function hasSession(req: Request): boolean {
  if (!authEnabled()) return true;
  const raw = req.headers.get("cookie") || "";
  const hit = raw
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!hit) return false;
  return safeEqual(decodeURIComponent(hit.slice(SESSION_COOKIE.length + 1)), expectedToken());
}

export function checkPassword(password: unknown): boolean {
  if (typeof password !== "string" || !password) return false;
  return safeEqual(password, process.env.APP_PASSWORD || "");
}

export function sessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${expectedToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`;
}

export function clearedCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

// ---- brute-force damping -------------------------------------------------
// Per-IP attempt counter with a short lockout. In-memory, so it resets on cold
// start and is per-instance — enough to make guessing slow, not a real WAF.
const attempts = new Map<string, { n: number; until: number }>();
const WINDOW = 15 * 60 * 1000;
const LIMIT = 10;

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

export function rateLimited(ip: string, now = Date.now()): boolean {
  const e = attempts.get(ip);
  return Boolean(e && e.n >= LIMIT && now < e.until);
}

export function noteFailure(ip: string, now = Date.now()) {
  const e = attempts.get(ip);
  if (!e || now >= e.until) attempts.set(ip, { n: 1, until: now + WINDOW });
  else attempts.set(ip, { n: e.n + 1, until: e.until });
}

export function clearFailures(ip: string) {
  attempts.delete(ip);
}
