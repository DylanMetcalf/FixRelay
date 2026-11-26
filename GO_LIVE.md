# ManOp go-live checklist (www.manop.co.za)

ManOp stays on the existing Render service (renamed **ManOp** in the dashboard, service id `srv-dbtu3b56e07s73b81gh0`). Its internal Render address stays `fixrelay-demo.onrender.com` – Render never changes that – but visitors only ever see **www.manop.co.za**.

## 1. Add the domain on Render
Render dashboard → service **ManOp** → **Settings** → **Custom Domains** → **Add Custom Domain**:
- `www.manop.co.za`
- `manop.co.za` (Render redirects it to www)

## 2. Change two records at domains.co.za
Log in at https://www.domains.co.za → **Client Area** → **Domains** → **manop.co.za** → **Manage** → **DNS Management** (on a hosting package: cPanel → **Zone Editor**).

| Type | Name / Host | Current value | Change it to |
|---|---|---|---|
| CNAME | `www` | `manop.co.za` | `fixrelay-demo.onrender.com` |
| A | `@` (or blank / `manop.co.za`) | `169.239.219.58` | `216.24.57.1` (check against the IP Render shows) |

- If the form wants a full stop at the end of the CNAME value, use `fixrelay-demo.onrender.com.`
- Delete any other A, AAAA or CNAME records for `@` or `www`.
- There are no email (MX) records on manop.co.za today, so nothing else is affected.

## 3. Verify
Render → **Custom Domains** → **Verify**. Usually 15–60 minutes, sometimes a few hours. Render issues the HTTPS certificate by itself.

## 4. Final switch (done by Claude/the developer once Render says "Verified")
- Set `APP_URL=https://www.manop.co.za` on the service and redeploy, so emails, QR codes and PDF links use the new address.
- Reprint QR signs printed before this change.

## Before 17 December 2026: the free database
The service and database are both on Render's **free** plan today ($0):
- the free web service sleeps after ~15 minutes idle (first visit then takes about a minute);
- the free database **expires on 17 December 2026** and its data is deleted.

Before real customers use it, in the Render dashboard:
- **Database** `fixrelay-demo-db` → **Upgrade** to *Basic 256 MB* (about US$7/month) – keeps all data. **This is the one that must be done before 17 December.**
- Optional: **ManOp** service → **Settings → Instance type** → *Starter* (about US$7/month) – always on, no sleeping.
