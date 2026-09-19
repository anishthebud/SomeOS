# SomeOS

SomeOS turns the ASUS machine into a private, filesystem-backed knowledge system. Raw data enters `sources/`; local Gemma compiles it into cited pages and actionable tasks under `wiki/`. The filesystem remains the source of truth.

## Vault layout

```text
sources/
  inbox/       Web quick captures
  daily/       Daily notes
  notes/       Curated source notes
  devices/     One folder per IoT device
  uploads/     Imported files
wiki/
  pages/       Gemma-generated knowledge pages
  tasks/       One Markdown file per task
  calendar/    Local calendar data
  log.md       Ingestion activity log
```

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

SomeOS requires `APP_PASSWORD` or `API_TOKEN`; private API routes fail closed if neither is configured.

## IoT capture

Devices post JSON to `/api/iot/ingest` with the `x-someos-key` header:

```bash
curl -X POST https://your-machine.your-tailnet.ts.net/api/iot/ingest \
  -H 'content-type: application/json' \
  -H 'x-someos-key: YOUR_KEY' \
  -d '{"device_id":"kitchen-sensor","title":"Room reading","data":{"temperature_f":72.4,"humidity":41}}'
```

The endpoint accepts either a string `content` field or arbitrary JSON in `data`. Captures are written under `sources/devices/<device-id>/` and become available to the next ingestion run.

## Production

The included `deploy/someos.service` runs the Next.js server on loopback port 3000. Tailscale Serve terminates private HTTPS and forwards to it. Keep `.env.local` private and rotate both `APP_PASSWORD` and `IOT_INGEST_KEY` if they are exposed.
