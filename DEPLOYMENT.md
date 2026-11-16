# Deployment

> This describes a sensible first deployment. It has **not** been performed for this project. Do the security and compliance review (SECURITY.md) before going live.

## Components

1. **Web app**: `npm run build`, then `npm start` (Node 22+). Stateless apart from the in-memory rate limiter and local file storage (see below).
2. **Worker**: `npm run worker`. One long-running process (more are safe). It sends the email outbox, raises overdue alerts and deletes expired sessions.
3. **PostgreSQL 14+** (tested on 16), managed and with automated backups. A South African or EU region is recommended for POPIA (decide with your compliance review).
4. **File storage**: today a local directory (`STORAGE_DIR`). This works on a single VM with a persistent disk. For a PaaS or more than one instance, implement an S3-compatible driver in `src/server/storage.ts` (2 methods: `put`, `get`).

## Environment variables

| Variable | Required | Example / notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/fixrelay?sslmode=require` |
| `APP_URL` | yes | `https://app.example.co.za`. Used in emailed links |
| `STORAGE_DIR` | yes (local driver) | `/var/lib/fixrelay/files`. Must persist and be backed up |
| `NODE_ENV` | yes | `production` (enables Secure cookies) |
| `EMAIL_TRANSPORT` | no | `console` (default: logs only) or `http` |
| `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM` | if `http` | Resend-compatible JSON API. **Untested against a live provider**: test before relying on it |
| `BCRYPT_COST` | no | default 12 |
| `WORKER_INTERVAL_MS` | no | default 15000 |
| `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` | seed only | Create the operator account once, then remove from the environment |

Never commit secrets. Use your host's secret manager.

## First deployment (single VM example)

```bash
npm ci
```

```bash
npm run db:migrate
```

```bash
PLATFORM_ADMIN_EMAIL=ops@yourco.example PLATFORM_ADMIN_PASSWORD='long-random-password' npm run db:seed
```

```bash
npm run build
```

Then run `npm start` and `npm run worker` under a process manager (systemd, pm2, or two PaaS processes), behind a TLS-terminating reverse proxy (Caddy or nginx) that sets `X-Forwarded-For`. HTTPS is mandatory: cookies are `Secure`, and PWAs require it.

## Releases

1. Back up the database.
2. `npm ci && npm run db:migrate && npm run build`.
3. Restart the web app and the worker.
Migrations must be backwards-compatible with the running version during the switch (see DATABASE.md, "Migration strategy").

## Backups and restore

- PostgreSQL: daily automated snapshots plus point-in-time recovery if available. Keep at least 30 days. **Test a restore** before launch and quarterly.
- Files in `STORAGE_DIR`: back up with the same schedule (file names are UUIDs; the database holds the mapping). Back up the database and files together.
- Encrypt backups at rest. Restrict who can access them (they contain personal information).

## Monitoring

- Health check: `GET /api/health` returns `{ ok: true }` (checks the DB).
- Alert on: web 5xx rate, health failures, worker not running, `OutboxEmail` rows with `status = 'FAILED'` or old `PENDING` rows:
  `SELECT status, count(*), min("createdAt") FROM "OutboxEmail" GROUP BY status;`
- Logs: the app logs `[action error]` for unexpected server errors and `[worker]` lines. Ship stdout to your log service. Logs do not contain passwords, tokens or email bodies.
- Error tracking (Sentry or similar) is not wired in yet. Recommended.

## Scaling notes

- More than one web instance needs: a shared rate limiter (`src/lib/rate-limit.ts`) and object storage instead of a local disk.
- Workers can scale horizontally (`SKIP LOCKED`).
- Watch report queries for large tenants (`services/reports.ts` aggregates in code with 5,000-row caps). Move them to SQL aggregates when needed.

## Billing provider

Subscriptions are managed today by the platform operator in `/platform` (plan, status, dates). To automate, implement `BillingProvider` in `services/billing.ts` for a South African provider (e.g. Paystack or PayFast) and translate its webhooks into `setSubscription()`. Never store card data. Plan prices live with the provider; plan limits live in the `Plan` table.
