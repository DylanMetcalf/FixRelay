# Deployment

Three supported ways to run FixRelay. All use the same code and environment variables. A fresh clone was installed, migrated, seeded, built and started from these docs against an empty database on 2026-11-17 (see TESTING.md). **Live demo:** https://fixrelay-demo.onrender.com, deployed from `render.demo.yaml` (Render free tier, Frankfurt). The free web service sleeps after about 15 minutes idle (the first visit then takes about a minute), and the free database **expires on 2026-12-17**, so move to the paid `render.yaml` before real use. Demo email is sent through Resend from `dylan@meacreo.co.za` with a sending-only key restricted to that domain, stored only in Render's environment.

## Option A: Render (simplest; `render.yaml` is included)
1. Push the repository to GitHub. In Render: **New → Blueprint**, then select the repository.
2. Render creates a Postgres database and one web service. The worker runs inside the web service (`WORKER_IN_PROCESS=true`) and files are stored in Postgres (`STORAGE_DRIVER=db`), so nothing else is needed to start.
3. Set the secret values in the dashboard: `APP_URL` (your Render URL or custom domain), `EMAIL_TRANSPORT=resend` or `smtp`, `EMAIL_FROM`, and `RESEND_API_KEY` or the `SMTP_*` values. Add `HEALTH_TOKEN` if you want detailed health output.
4. After the first deploy, open Render's shell and create the operator account:
   `PLATFORM_ADMIN_EMAIL=you@yourco.co.za PLATFORM_ADMIN_PASSWORD='long-random-password' npm run db:seed`
5. Antivirus (recommended): add a private service from the `clamav/clamav:stable` image and set `CLAMAV_HOST` to its internal hostname.

## Option B: One server with Docker Compose (includes ClamAV)
```bash
cp .env.example .env    # set APP_URL, EMAIL_*, POSTGRES_PASSWORD
```

```bash
docker compose up -d --build
```

```bash
docker compose exec web sh -c "PLATFORM_ADMIN_EMAIL=you@yourco.co.za PLATFORM_ADMIN_PASSWORD='long-random-password' npm run db:seed"
```

Put Caddy or nginx in front for HTTPS (required: cookies are `Secure`/`__Host-` and PWAs need HTTPS). The `Dockerfile` and `docker-compose.yml` follow standard patterns but **were not built in the development sandbox (no Docker available there)**. Build them once before relying on them.

## Option C: Plain Node.js (any VM or PaaS)
```bash
npm ci && npm run db:migrate && npm run build
```

Then run `npm start` (web) and `npm run worker` (background), or only `npm start` with `WORKER_IN_PROCESS=true`.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL 14+ (tested on 16). Add `?sslmode=require` for managed databases |
| `APP_URL` | yes | Public HTTPS URL. Used in emailed links |
| `NODE_ENV` | yes | `production` |
| `STORAGE_DRIVER` | no | `db` (default; files in Postgres, multi-instance, included in DB backups), `s3`, or `local` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_SSE` | if `s3` | Any S3-compatible store (AWS S3 af-south-1, Cloudflare R2, Backblaze B2, MinIO). Bucket must be **private** |
| `EMAIL_TRANSPORT` | no | `console` (default, logs only), `smtp`, `resend` |
| `EMAIL_FROM` | if not console | e.g. `FixRelay <no-reply@yourdomain.co.za>` on a domain with SPF and DKIM |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE` | if `smtp` | Port 587 uses STARTTLS (required by default); 465 uses TLS |
| `RESEND_API_KEY` | if `resend` | |
| `CLAMAV_HOST`, `CLAMAV_PORT` or `CLAMAV_SOCKET` | recommended | When set, every upload is scanned. **If ClamAV is unreachable, uploads are refused** (fail closed) |
| `TRUSTED_PROXY_HOPS` | no | Number of proxies in front of the app (default 1). Used to read the real client IP for rate limiting. Set 0 if the app is reached directly |
| `WORKER_IN_PROCESS` | no | `true` runs the background loop inside the web process |
| `HEALTH_TOKEN` | no | Enables `/api/health?token=…` details (email backlog) |
| `BCRYPT_COST`, `WORKER_INTERVAL_MS` | no | Defaults 12 and 15000 |

## Email setup checklist
1. Verify your sending domain with the provider (SPF, DKIM, ideally DMARC).
2. Set `EMAIL_TRANSPORT`, `EMAIL_FROM` and credentials.
3. Register a test company: the confirmation email must arrive. Then use "Forgot password?".
4. Watch `/api/health?token=…`: `emailBacklogMinutes` should stay near 0.
The SMTP transport was verified against a real SMTP server and the Resend transport against an HTTP stand-in, both in automated tests. Neither has been run against a live provider account.

## Backups and restore
- Database: daily snapshots plus point-in-time recovery; keep ≥ 30 days; encrypted. With `STORAGE_DRIVER=db` the files are inside these backups. With `s3`, enable bucket versioning and lifecycle rules.
- **Test a restore** before launch and every quarter.

## Monitoring
- `GET /api/health` → `{ ok: true }` (database reachable). With the token: `emailBacklogMinutes`, `emailsFailedLast24h`.
- Alert on 5xx rate, health failures, growing email backlog, and `[scan] ClamAV unavailable` log lines.
- Logs contain no passwords, tokens or email bodies.

## Releases
Back up → `npm ci && npm run db:migrate && npm run build` → restart. Migrations are additive and non-destructive (see DATABASE.md).
