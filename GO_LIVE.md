# ManOp go-live checklist (www.manop.co.za)

This moves ManOp off the old free test server (`fixrelay-demo.onrender.com`) to a paid, always-on ManOp server, with the address **www.manop.co.za**. Everything in the code is ready; the steps below are the ones only the account owner can do (they start billing or change DNS).

Cost on Render: web service *Starter* about US$7/month + database *Basic 256 MB* about US$7/month (prices may vary slightly; Render shows them before you confirm).

---

## 1. Create the ManOp server on Render (about 5 minutes)

1. Go to https://dashboard.render.com → **New** → **Blueprint**.
2. Pick the GitHub repository **DylanMetcalf/FixRelay**.
   - **Branch:** `claude/quirky-archimedes-x415o3`
   - **Blueprint path:** `render.yaml`
   - **Blueprint name:** `ManOp`
3. Render lists what it will create: a web service **manop** and a database **manop-db**. It asks for these values:

   | Setting | Value |
   |---|---|
   | `APP_URL` | `https://www.manop.co.za` |
   | `EMAIL_FROM` | `ManOp <dylan@meacreo.co.za>` (meacreo.co.za is already verified in Resend) |
   | `RESEND_API_KEY` | Copy it from the old service: **fixrelay-demo (now called ManOp) → Environment → RESEND_API_KEY → reveal → copy** |

4. Click **Apply**. The first build takes about 5–8 minutes.
5. When it is live, open the new service and note its address at the top, normally **`manop.onrender.com`** (if that name was already taken anywhere on Render, Render adds a few letters, e.g. `manop-ab12.onrender.com`; use whatever it shows).
6. Check it works: open `https://manop.onrender.com/api/health` → it should say `{"ok":true}`.

## 2. Create your platform owner login

On the new **manop** service → **Shell**, run (use your own email and a long password, at least 12 characters):

```
PLATFORM_ADMIN_EMAIL=you@yourco.co.za PLATFORM_ADMIN_PASSWORD='a long random password' npm run db:seed
```

Sign in at `/login`; you land on **Platform admin**, where customer companies are created. The public sandbox at `/demo` works straight away, no setup needed.

## 3. Add the domain on Render

New **manop** service → **Settings** → **Custom Domains** → **Add Custom Domain**:
- `www.manop.co.za`
- `manop.co.za` (Render redirects it to www)

## 4. Change two records at domains.co.za

Log in at https://www.domains.co.za → **Client Area** → **Domains** → **manop.co.za** → **Manage** → **DNS Management** (on a hosting package it is cPanel → **Zone Editor**).

| Type | Name / Host | Current value | Change it to |
|---|---|---|---|
| CNAME | `www` | `manop.co.za` | `manop.onrender.com` (the address from step 1.5) |
| A | `@` (or blank / `manop.co.za`) | `169.239.219.58` | `216.24.57.1` (check against the IP Render shows in step 3) |

- If the form wants a full stop at the end of the CNAME value, use `manop.onrender.com.`
- Delete any other A, AAAA or CNAME records for `@` or `www`.
- There are no email (MX) records on manop.co.za today, so nothing else is affected.

## 5. Verify

Back on Render → **Custom Domains** → **Verify** next to each one. domains.co.za changes usually show within 15–60 minutes (sometimes a few hours). Render then issues the HTTPS certificate by itself. Open **https://www.manop.co.za** – done.

## 6. Retire the old test server

Once www.manop.co.za works:
- Delete the old web service (the one whose address is `fixrelay-demo.onrender.com`) and its free database **fixrelay-demo-db**. That database expires on 17 December 2026 anyway.
- Anything created on the old server (test companies, sandboxes) is not carried over; its database does not allow outside connections, so it can't be copied. The new server starts clean.
- Print QR signs from the new server: every sign printed earlier points at the old address and stops working once the old server is deleted.

Optional later: verify `manop.co.za` in Resend and change `EMAIL_FROM` to e.g. `ManOp <noreply@manop.co.za>`.
