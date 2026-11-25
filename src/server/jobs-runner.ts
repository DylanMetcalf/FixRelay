/**
 * The background loop shared by the standalone worker (src/worker.ts) and the optional in-process mode
 * (WORKER_IN_PROCESS=true, started from src/instrumentation.ts) for single-instance hosting.
 * Safe with several copies running: outbox rows are claimed with SKIP LOCKED and overdue alerts are guarded.
 */
import { transportFromEnv } from "./email";
import { processOutbox, purgeRetention, scanOverdue } from "./services/notifications";
import { cleanupSandboxes } from "./services/demo";

export function startBackgroundLoop(opts: { intervalMs?: number; log?: (m: string) => void } = {}) {
  const intervalMs = opts.intervalMs ?? Number(process.env.WORKER_INTERVAL_MS ?? 15_000);
  const log = opts.log ?? ((m: string) => console.log(`[worker] ${m}`));
  const transport = transportFromEnv(); // throws early on bad email configuration
  let stopped = false;
  let tick = 0;
  let lastPurge = 0;
  log(`started (email=${transport.name}, every ${intervalMs}ms)`);
  const loop = async () => {
    while (!stopped) {
      try {
        const r = await processOutbox(transport, 50);
        if (r.sent || r.failed) log(`emails sent=${r.sent} failed=${r.failed}`);
        if (tick++ % 20 === 0) {
          const n = await scanOverdue();
          if (n) log(`overdue alerts=${n}`);
          const g = await cleanupSandboxes();
          if (g) log(`expired sandboxes archived=${g}`);
        }
        if (Date.now() - lastPurge > 6 * 3_600_000) {
          lastPurge = Date.now();
          log(`retention purge ${JSON.stringify(await purgeRetention())}`);
        }
      } catch (e) {
        console.error("[worker] error", e);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  void loop();
  return () => { stopped = true; };
}
