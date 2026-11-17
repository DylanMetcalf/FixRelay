/** Next.js startup hook. With WORKER_IN_PROCESS=true the background loop runs inside the web server process. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.WORKER_IN_PROCESS === "true") {
    const { startBackgroundLoop } = await import("./server/jobs-runner");
    startBackgroundLoop();
  }
}
