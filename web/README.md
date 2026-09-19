# Cortex — web viewer

A standalone Next.js web viewer for the wiki, living **inside the vault repo**
(`web/`) but deployed **separately on Vercel**. It is unrelated to the Slack
bot — they just share the same Git repo as the source of truth.

Inspired by the EgoVerse `egoverse-obsidian` dashboard, minus accounts/login.

## What it does

| Tab | Source | Read | Write |
|-----|--------|------|-------|
| **Overview** | aggregate | live/build | — (hub: streak, task progress, recent activity) |
| **Today** | `sources/daily/<M-D-YY>.md` | live | ✅ block editor + voice notes; "Save to wiki" commits it |
| **Daily** | `sources/daily/*.md` | live | ✅ open any past day and edit it (same editor) |
| **Wiki** | `wiki/pages/*.md` | live/build | — (LLM-generated; not hand-edited) |
| **Tasks** | `wiki/tasks/*.md` | live/build | ✅ quick-add + status toggle |
| **Activity** | `wiki/log.md` | live/build | — (op-log feed) |

"Read: live/build" = served from the build-time snapshot, or from the optional
Convex live-mirror when `NEXT_PUBLIC_CONVEX_URL` is set (real-time, no redeploy).

## How data flows

- **Reads** happen at **build time**: the home page is a server component that
  reads the repo's markdown and ships a static site to Vercel's CDN. Push to the
  repo → Vercel redeploys → the site refreshes.
- **Writes** go through dynamic API routes that **commit `.md` files to GitHub**
  (`lib/storage.ts`). On Vercel they use the GitHub Contents API; in local dev
  (no token) they write the local filesystem vault, so everything is testable
  on the machine that holds the files.
- The **daily loop**: jot in *Today* → *Save to wiki* writes
  `sources/daily/<date>.md` → your existing nightly `/ingest` (Slack-bot side,
  over git) folds it into `wiki/pages/` → a fresh blank *Today* opens tomorrow.

The website never touches the GT machine; the Slack bot's git sync closes the loop.

## Run locally

```bash
cd web
npm install
npm run dev          # no token → writes the local filesystem vault (../)
# → http://localhost:3000
```

`npm run build && npm run start` serves the production build the same way Vercel
does. Pick a port with `PORT=3210 npm run start`.

## Deploy

See [DEPLOY.md](./DEPLOY.md).

## Stack

Next.js 15 (App Router) · React 19 · BlockNote editor · react-markdown +
remark-gfm · gray-matter. No auth. **Git is the source of truth**; writes go
through the GitHub Contents API. An **optional** Convex live-mirror
(`NEXT_PUBLIC_CONVEX_URL`) adds real-time reads without a redeploy — leave it
unset and the app runs fully on the build-time snapshot.
