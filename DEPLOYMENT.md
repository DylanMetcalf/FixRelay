# Deployment

ManOp (formerly FixRelay) runs as one Node.js web service plus PostgreSQL. All options below use the same code and environment variables. Service, database and cookie names keep their earlier `fixrelay` identifiers on purpose, so existing deployments and sessions keep working.

**Current demo:** https://fixrelay-demo.onrender.com, deployed from `render.demo.yaml` (Render free tier, Frankfurt). The free web service sleeps after about 15 minutes idle (the first visit then takes about a minute), and the free database **expires on 2026-12-17**. Move to the paid `render.yaml` before the pilot. The ManOp domain is **not** assumed: everything uses `APP_URL`, so the domain can be added later.

## Option A: Render (recommended for the pilot)

1. Push the repository to GitHub. In Render: **New → Blueprint** and select the repository (`render.yaml`).
2. Render creates a Postgres database and one web service. The background worker runs inside the web service (`WORKER_IN_PROCESS=true`), and **all files (photos, signatures, logos, profile photos) are stored in Postgres** (`STORAGE_DRIVER=db`). Nothing is written to Render's local disk, which is wiped on every deploy, so no extra storage service is needed. Database backups include the files.
3. Build: `npm ci --include=dev && npm run build`. Start: `npx prisma migrate deploy && npx next start -p $PORT`. Migrations are additive (new tables and nullable or defaulted columns), so they are safe on every deploy.
4. Health check path: `/api/health` (returns `{"ok":true}` when the database is reachable).
5. Set the secret values in the dashboard: `APP_URL`, `EMAIL_TRANSPORT=resend`, `EMAIL_FROM`, `RESEND_API_KEY` (see "Resend" below). Optional: `HEALTH_TOKEN`.
6. After the first deploy, open Render's **Shell** and create the platform owner's account:
   `PLATFORM_ADMIN_EMAIL=you@yourco.co.za PLATFORM_ADMIN_PASSWORD='a long random password' npm run db:seed`
   Sign in at `/login`; the platform owner lands on `/platform` (Platform admin), where customer companies are created.
7. Antivirus (recommended): add a private service from the `clamav/clamav:stable` image and set `CLAMAV_HOST` to its internal host name. When it is set and unreachable, uploads are refused (fail closed).

### PDF generation on Render
Job cards, completion reports, history reports and QR signs are generated on the server with `@react-pdf/renderer`, which is pure JavaScript: **no Chromium or other browser is needed** on the server. The Inter fonts are bundled in `assets/fonts/` (SIL Open Font License, see `LICENSE-Inter-OFL.txt`), so output is identical on every machine. PDFs are generated on request and streamed; they are never written to disk or stored, so there is nothing stale to clean up or leak. Memory: a job card with four photos peaks well under 100 MB; the Starter instance (512 MB) is enough, the free 512 MB instance works but is slower on its first request.

### Custom domain and HTTPS
1. In the web service: **Settings → Custom Domains → Add**, e.g. `app.manop.co.za` (once the domain is owned).
2. Add the DNS record Render shows (CNAME to the `onrender.com` host, or the A/ALIAS record for an apex domain). Render issues and renews the TLS certificate automatically; HTTP redirects to HTTPS.
3. Change `APP_URL` to `https://app.manop.co.za` and redeploy. Emailed links, QR codes and PDF links use it. **Print QR signs after this change**: signs printed with the old address will still point to the old address.
4. HTTPS is required in production: session cookies are `Secure` with the `__Host-` prefix, HSTS is sent, and the installable app needs HTTPS.

### Staging / pilot environment
Use a second Blueprint from `render.demo.yaml` (or a copy of `render.yaml` with a different service name) for a staging environment with its own database. Testers can also use an isolated pilot company on production: the platform owner creates it in Platform admin; companies never see each other's data. Demo workspaces (sample data) are separate companies flagged as demos and never send email.

## Option B: One server with Docker Compose (includes ClamAV)
```bash
cp .env.example .env
```

Set `APP_URL`, `EMAIL_*` and `POSTGRES_PASSWORD` in `.env`, then:

```bash
docker compose up -d --build
```

```bash
docker compose exec web sh -c "PLATFORM_ADMIN_EMAIL=you@yourco.co.za PLATFORM_ADMIN_PASSWORD='a long random password' npm run db:seed"
```

Put Caddy or nginx in front for HTTPS. The image copies the whole repository (including `assets/fonts`). The `Dockerfile` and `docker-compose.yml` follow standard patterns but **were not built in the development sandbox (no Docker there)**. Build them once before relying on them.

## Option C: Plain Node.js (any VM or PaaS)
```bash
npm ci && npm run db:migrate && npm run build
```

Then run `npm start` (web) and `npm run worker` (background), or only `npm start` with `WORKER_IN_PROCESS=true`. Keep the `assets/` folder next to the app (fonts for PDFs).

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL 14+ (tested on 16). Add `?sslmode=require` for managed databases |
| `APP_URL` | yes | Public HTTPS URL, e.g. `https://app.manop.co.za`. Used in emails, QR codes and PDF links. On Render, `RENDER_EXTERNAL_URL` is used if it is not set |
| `NODE_ENV` | yes | `production` |
| `STORAGE_DRIVER` | no | `db` (default; files in Postgres, works with several instances, included in database backups), `s3`, or `local` (development only: not for Render, whose disk is temporary) |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_SSE` | if `s3` | Any S3-compatible store (AWS S3 af-south-1, Cloudflare R2, Backblaze B2). Bucket must be **private** |
| `EMAIL_TRANSPORT` | no | `console` (default, logs a one-line summary only), `smtp`, `resend` |
| `EMAIL_FROM` | if not console | e.g. `ManOp <notifications@mail.manop.co.za>` on a verified domain |
| `RESEND_API_KEY` | if `resend` | A **sending-only** key, restricted to the sending domain |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | if `smtp` | 587 uses STARTTLS; 465 uses TLS |
| `CLAMAV_HOST`, `CLAMAV_PORT` or `CLAMAV_SOCKET` | recommended | Every upload is scanned; unreachable = uploads refused |
| `TRUSTED_PROXY_HOPS` | no | Proxies in front of the app (default 1, correct for Render). Used to read the real client IP for rate limiting |
| `WORKER_IN_PROCESS` | no | `true` runs the background loop (emails, overdue alerts, retention) inside the web process |
| `HEALTH_TOKEN` | no | Enables `/api/health?token=…` details (email backlog, failures) |
| `BCRYPT_COST`, `WORKER_INTERVAL_MS` | no | Defaults 12 and 15000 |

Secrets are never committed. `.env.example` lists the names only.

## Resend (email)

1. **Account and domain.** In Resend: **Domains → Add domain**. Use a sub-domain you own for sending, e.g. `mail.manop.co.za` (keeps your main domain's reputation separate). Choose a region close to your users (EU / Ireland is closest to South Africa).
2. **DNS.** Add the records Resend shows at your DNS provider: the SPF `TXT` record and the DKIM `CNAME`/`TXT` records (and the optional MX record for bounces). Add a DMARC record for the parent domain, starting with `v=DMARC1; p=none; rua=mailto:dmarc@manop.co.za`, and tighten it to `quarantine` once mail flows. Wait until Resend shows the domain as **Verified**.
3. **API key.** **API Keys → Create**: permission **Sending access**, restricted to the verified domain. Copy it once; store it only in Render (`RESEND_API_KEY`). Never commit it or paste it into a ticket.
4. **Sender.** Set `EMAIL_FROM=ManOp <notifications@mail.manop.co.za>` and `EMAIL_TRANSPORT=resend`. Company-specific emails show the customer's company name and colour in the message, but are sent from this address.
5. **Development and tests.** Leave `EMAIL_TRANSPORT=console` (the default) in development: emails are written to the database outbox and only a one-line summary is logged. Automated tests never send email (they read the outbox), and addresses on reserved domains (`example.com`, `.test`, `.invalid`, …) are never delivered. Demo companies never queue email at all. To try real delivery safely, Resend accepts `delivered@resend.dev`.
6. **Production check.** Register a test company with a real inbox: the confirmation email must arrive. Then try "Forgot password?" and an invitation. Platform admin → Platform health shows sent / waiting / failed counts and the last errors.
7. **Delivery tracking.** Each email is stored in the outbox with its status (`PENDING`, `SENT`, `FAILED`), attempts and the last error; failures are retried with back-off (5 attempts) and duplicates are suppressed by a unique key per event and recipient.

## Backups and restore
- Render Postgres (paid plans) takes daily snapshots with point-in-time recovery; keep at least 30 days. With `STORAGE_DRIVER=db`, photos and signatures are inside these backups.
- Restore: Render dashboard → database → **Recovery** → choose a point in time → restore to a new database, then point `DATABASE_URL` at it and redeploy. **Test a restore before the pilot starts** and quarterly after that.
- Manual export: `pg_dump --format=custom "$DATABASE_URL" > manop.dump`; restore with `pg_restore --clean --no-owner -d "$NEW_DATABASE_URL" manop.dump`.
- Each company's owner can also download a full JSON export of their data from Settings.

## Monitoring and error logging
- `GET /api/health` → `{"ok":true}`; with `?token=` the email backlog and failures. Use it for Render's health check and an external uptime monitor (e.g. UptimeRobot every 5 minutes).
- Unexpected server errors are written to the `ErrorLog` table (message, path, company and user ids; no request bodies or personal data) and shown in **Platform admin → Platform health**, as well as in Render's logs.
- Alert on: health check failures, 5xx responses, growing email backlog, failed emails, and `[scan] ClamAV unavailable` log lines.

## Releases
Back up → deploy (Render runs `prisma migrate deploy` on start) → smoke test (sign in, open a job, download a job card, submit a QR report). Rollback: redeploy the previous commit. Migrations only add tables and columns, so the previous release runs on the newer database.

## Small instances (free / 512 MB)
`next build` runs ESLint and a TypeScript check inside the build, which can run out of memory on a 512 MB machine. `render.demo.yaml` therefore runs `tsc --noEmit` separately under a heap cap and sets `SKIP_BUILD_CHECKS=1` plus `NODE_OPTIONS=--max-old-space-size=400`. Paid instances (`render.yaml`) build normally. If pushes do not start a deploy, use **Manual Deploy** in the Render dashboard (the GitHub connection is not set for automatic deploys).
