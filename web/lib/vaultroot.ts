import fs from "fs";
import path from "path";

// The vault root — the directory that holds `sources/` and `wiki/`. Resolved once:
//   1. `VAULT_PATH` env var, if set — point this at your own content repo/checkout.
//   2. else the bundled starter vault (`examples/vault`) when present, so a fresh
//      `git clone && npm run dev` runs on the empty starter out of the box.
//   3. else the parent directory of `web/` (the "content lives one dir above the
//      app" layout, e.g. if you drop your own `sources/` + `wiki/` at the repo root).
function resolveVaultRoot(): string {
  if (process.env.VAULT_PATH) return path.resolve(process.env.VAULT_PATH);
  const example = path.resolve(process.cwd(), "../examples/vault");
  try {
    if (fs.existsSync(path.join(example, "wiki"))) return example;
  } catch {
    /* fall through */
  }
  return path.resolve(process.cwd(), "..");
}

export const VAULT_ROOT = resolveVaultRoot();
