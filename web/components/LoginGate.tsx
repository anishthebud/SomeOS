"use client";

// Password gate for the whole app. Login is OPT-IN: with no APP_PASSWORD set on
// the deployment the session endpoint reports `enabled: false` and this renders
// its children straight through, so a local clone or public demo needs nothing.
//
// When it is enabled the write API enforces the same session server-side (see
// lib/apiauth.ts), so this screen is the front door rather than mere decoration.
import { useCallback, useEffect, useState } from "react";

type State = "checking" | "open" | "locked" | "authed";

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.reload();
}

export function LoginGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      const r = await fetch("/api/auth/session", { cache: "no-store" });
      const { enabled, authed } = (await r.json()) as { enabled: boolean; authed: boolean };
      setState(!enabled ? "open" : authed ? "authed" : "locked");
    } catch {
      // If the check itself fails (offline, static preview), don't strand the
      // user behind a door we can't verify.
      setState("open");
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const b = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !b.ok) {
        setErr(b.error || "Sign-in failed.");
        setPassword("");
      } else {
        setState("authed");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking") return <div className="login-boot" aria-busy="true" />;
  if (state === "open" || state === "authed") return <>{children}</>;

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="login-mark" src="/icon.svg" alt="" width={72} height={72} />
        <h1 className="login-title">SomeOS</h1>
        <p className="login-tag">Your private knowledge system.</p>

        <label className="login-label" htmlFor="someos-password">
          Password
        </label>
        <input
          id="someos-password"
          className="login-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          disabled={busy}
        />

        {err && (
          <div className="login-err" role="alert">
            {err}
          </div>
        )}

        <button className="btn btn-primary login-btn" type="submit" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <p className="login-foot">
          This password protects the private files and model running on your machine.
        </p>
      </form>
    </div>
  );
}
