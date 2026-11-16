/**
 * Background worker: delivers queued emails and raises overdue alerts.
 * Run alongside the web app:  npm run worker
 * Safe to run more than one copy (rows are claimed with SKIP LOCKED).
 */
import { prisma } from "@/lib/db";
import { consoleTransport, type EmailTransport, processOutbox, scanOverdue } from "@/server/services/notifications";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 15_000);

/** Minimal HTTP transport for Resend-compatible APIs. UNTESTED against a live provider — see DEPLOYMENT.md. */
const httpTransport: EmailTransport = {
  async send(m) {
    const res = await fetch(process.env.EMAIL_API_URL ?? "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.EMAIL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.body }),
    });
    if (!res.ok) throw new Error(`Email provider responded ${res.status}`);
  },
};
const transport = process.env.EMAIL_TRANSPORT === "http" ? httpTransport : consoleTransport;

let stopping = false;
process.on("SIGTERM", () => (stopping = true));
process.on("SIGINT", () => (stopping = true));

async function main() {
  console.log(`[worker] started (transport=${process.env.EMAIL_TRANSPORT ?? "console"}, every ${INTERVAL_MS}ms)`);
  let tick = 0;
  while (!stopping) {
    try {
      const r = await processOutbox(transport, 50);
      if (r.sent || r.failed) console.log(`[worker] emails sent=${r.sent} failed=${r.failed}`);
      if (tick++ % 20 === 0) {
        const n = await scanOverdue();
        if (n) console.log(`[worker] overdue alerts=${n}`);
        await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      }
    } catch (e) {
      console.error("[worker] error", e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  await prisma.$disconnect();
}
void main();
