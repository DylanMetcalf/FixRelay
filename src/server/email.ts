/**
 * Email delivery. Choose with EMAIL_TRANSPORT:
 *   console (default) – prints a one-line summary (no bodies: they can contain secret links).
 *   smtp              – any SMTP provider (Postmark, SES, Mailgun, SendGrid, Google Workspace, Microsoft 365…).
 *                       SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASS, SMTP_SECURE=true for port 465.
 *   resend            – Resend HTTPS API. RESEND_API_KEY (EMAIL_API_URL to override the endpoint).
 * EMAIL_FROM is required for smtp/resend, e.g. "FixRelay <no-reply@yourdomain.co.za>" on a domain with SPF/DKIM.
 */
import nodemailer from "nodemailer";

export interface EmailMessage { to: string; subject: string; text: string; html: string; replyTo?: string }
export interface EmailTransport { name: string; send(msg: EmailMessage): Promise<void> }

export const consoleTransport: EmailTransport = {
  name: "console",
  async send(m) {
    console.log(`[email] to=${m.to} subject=${JSON.stringify(m.subject)}`);
  },
};

export function smtpTransport(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  const port = Number(env.SMTP_PORT ?? 587);
  const t = nodemailer.createTransport({
    host: env.SMTP_HOST, port, secure: env.SMTP_SECURE === "true" || port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    requireTLS: env.SMTP_REQUIRE_TLS !== "false" && port === 587,
    tls: env.SMTP_TLS_INSECURE === "true" ? { rejectUnauthorized: false } : undefined, // only for local test servers
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  return {
    name: "smtp",
    async send(m) {
      await t.sendMail({ from: env.EMAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html, replyTo: m.replyTo });
    },
  };
}

export function resendTransport(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  return {
    name: "resend",
    async send(m) {
      const res = await fetch(env.EMAIL_API_URL ?? "https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html, ...(m.replyTo ? { reply_to: m.replyTo } : {}) }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

export function transportFromEnv(env: NodeJS.ProcessEnv = process.env): EmailTransport {
  const kind = env.EMAIL_TRANSPORT ?? "console";
  if (kind === "console") return consoleTransport;
  if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM must be set when EMAIL_TRANSPORT is not console");
  if (kind === "smtp") {
    if (!env.SMTP_HOST) throw new Error("EMAIL_TRANSPORT=smtp needs SMTP_HOST");
    return smtpTransport(env);
  }
  if (kind === "resend" || kind === "http") {
    if (!env.RESEND_API_KEY) throw new Error("EMAIL_TRANSPORT=resend needs RESEND_API_KEY");
    return resendTransport(env);
  }
  throw new Error(`Unknown EMAIL_TRANSPORT "${kind}"`);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Branded HTML version of a plain-text email. The first URL becomes a button; text is escaped.
 * Colours come from the sending company (or FixRelay's own brand for account emails).
 */
export function renderEmailHtml(opts: { subject: string; text: string; brandName: string; brandColour: string }): string {
  const colour = /^#[0-9a-fA-F]{6}$/.test(opts.brandColour) ? opts.brandColour : "#1E5AA8";
  const url = /https?:\/\/[^\s]+/.exec(opts.text)?.[0];
  const body = esc(opts.text.replace(url ?? "\u0000", "")).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
  const button = url
    ? `<p style="margin:24px 0"><a href="${esc(url)}" style="background:${colour};color:#ffffff;padding:12px 22px;border-radius:6px;font-weight:700;text-decoration:none;display:inline-block">Open in FixRelay</a></p>
       <p style="font-size:12px;color:#6b7280">Or paste this link into your browser:<br><span style="word-break:break-all">${esc(url)}</span></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:${colour};color:#ffffff;padding:16px 24px;font-size:18px;font-weight:800">${esc(opts.brandName)}</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:18px;margin:0 0 12px">${esc(opts.subject)}</h1><p>${body}</p>${button}</td></tr>
<tr><td style="padding:16px 24px;background:#f9fafb;font-size:12px;color:#6b7280">Sent by FixRelay on behalf of ${esc(opts.brandName)}. You received this because of an account or maintenance job involving this address.</td></tr>
</table></td></tr></table></body></html>`;
}
