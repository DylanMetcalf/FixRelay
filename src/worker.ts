/**
 * Standalone background worker: email delivery, overdue alerts, retention clean-up.
 *   npm run worker
 * Alternative for single-instance hosting: set WORKER_IN_PROCESS=true on the web app instead.
 */
import { prisma } from "@/lib/db";
import { startBackgroundLoop } from "@/server/jobs-runner";

const stop = startBackgroundLoop();
const shutdown = async () => {
  stop();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
