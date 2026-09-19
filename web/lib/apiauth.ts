// Gate for the write/action API. Two independent mechanisms:
//
//   • APP_PASSWORD (login) — a real user gate. When set, the site requires a
//     sign-in and every write must carry a valid session cookie (or an explicit
//     API_TOKEN, for headless clients like Raycast/Shortcuts). See lib/auth.ts.
//   • API_TOKEN — a shared secret so *external* frontends can integrate. On its
//     own it is NOT user auth: with no APP_PASSWORD the site is a public SPA, so
//     same-origin browser writes are allowed through and the token only stops
//     casual/accidental external writes.
//
// Applied to WRITE methods only (POST/PUT/PATCH/DELETE); GET reads stay open so
// widgets can pull freely and the browser's GETs (which don't send Origin) work.
import { authEnabled, hasSession } from "./auth";

function tokenPresented(req: Request, token: string): boolean {
  if (!token) return false;
  if ((req.headers.get("authorization") || "") === `Bearer ${token}`) return true;
  return req.headers.get("x-api-token") === token;
}

export function apiAuthorized(req: Request): boolean {
  const token = process.env.API_TOKEN || "";

  // Login configured → a signed-in browser, or a headless client with the
  // shared secret. Being same-origin is NOT enough; that is the whole point.
  if (authEnabled()) return hasSession(req) || tokenPresented(req, token);

  if (!token) return true; // no login, no token → open (local/demo default)

  // 1) explicit token from an external client
  if (tokenPresented(req, token)) return true;

  // 2) same-origin browser request (the web app). Browsers send an Origin
  //    header on non-GET fetches; match it to this deployment's host.
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  const appOrigin = process.env.APP_ORIGIN || "";
  if (appOrigin && origin.startsWith(appOrigin)) return true;
  try {
    const host = req.headers.get("host");
    if (host && origin && new URL(origin).host === host) return true;
  } catch {
    /* malformed origin → fall through to deny */
  }
  return false;
}

// SomeOS exposes private, machine-local knowledge. Unlike Cortex's public-read
// routes, these endpoints fail closed unless a login password or API token is
// configured, and require that credential for reads as well as writes.
export function privateApiAuthorized(req: Request): boolean {
  if (!process.env.APP_PASSWORD && !process.env.API_TOKEN) return false;
  return apiAuthorized(req);
}

/** Standard 401 body when a write is rejected. */
export function unauthorized() {
  return authEnabled()
    ? { error: "unauthorized — sign in, or send Authorization: Bearer <API_TOKEN>" }
    : { error: "unauthorized — send Authorization: Bearer <API_TOKEN>" };
}
