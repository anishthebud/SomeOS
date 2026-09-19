# Deploying the web viewer to Vercel

The app lives in `web/` inside the wiki repo and deploys as its own Vercel
project. It reads the vault's markdown at build time and commits edits back to
GitHub at runtime.

## 1. Create a GitHub token (for write-back)

A **fine-grained Personal Access Token** scoped to just this repo:

- GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new
- Repository access: **Only select repositories** → `your-username/your-wiki-repo`
- Permissions: **Contents → Read and write**
- Copy the token (starts with `github_pat_…`).

This token only lives in Vercel's server env; it is never sent to the browser.

## 2. Import the project on Vercel

- Vercel → **Add New… → Project** → import `your-username/your-wiki-repo`.
- **Root Directory:** set to `web`.
  - Make sure **"Include files outside the Root Directory in the build"** is
    enabled (default for monorepos) — the build reads `../wiki` and `../sources`.
- Framework preset: **Next.js** (auto-detected).

## 3. Set environment variables

In the Vercel project → Settings → **Environment Variables** (Production +
Preview):

| Name | Value |
|------|-------|
| `GITHUB_TOKEN` | the fine-grained token from step 1 |
| `GITHUB_REPO` | `your-username/your-wiki-repo` |
| `GITHUB_BRANCH` | `main` |

**Voice notes (speech-to-text) — no setup needed.** The **Record** button in the
Daily/Today editor works out of the box on browsers with the Web Speech API
(Chrome, and Safari incl. iOS): transcription runs **on-device, free, with no
API key or provider**.

Only browsers *without* Web Speech fall back to server transcription, which is
**optional** and OpenAI-compatible:

| Name | Value |
|------|-------|
| `STT_API_KEY` | *(optional fallback)* an OpenAI or Groq key |
| `STT_BASE_URL` | *(optional)* `https://api.groq.com/openai/v1` for Groq |
| `STT_MODEL` | *(optional)* `whisper-large-v3` for Groq |

Audio is transcribed and discarded — never stored — so no database is involved.

Deploy. Your site is live at `https://<project>.vercel.app`.

## 4. How updates appear

- **Wiki / Tasks / Daily / Activity** are baked at build time. They refresh on
  the next deploy. Any push to the repo (including the app's own commits, and the
  Slack bot's pushes) triggers a Vercel redeploy automatically.
- **Today** is read live and saved live via the GitHub API, so it always shows
  the current day and your latest save without waiting for a redeploy.

## 5. Closing the daily loop

When you press **Save to wiki**, the app commits `sources/daily/<date>.md`. Your
existing nightly `/ingest` (on the GT machine, via its normal `git pull`) then
synthesizes that note into `wiki/pages/`. Nothing about the website needs to run
on the GT machine — the shared GitHub repo is the only link.

## Notes

- Each save / task edit is a commit, which redeploys the site. That's fine for a
  personal tool; if commit volume ever matters, batch edits before saving.
- No token configured (e.g. local `npm run dev`) → writes hit the local
  filesystem vault instead of GitHub, so you can develop without a token.
