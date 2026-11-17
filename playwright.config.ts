import { defineConfig } from "@playwright/test";

const PORT = 3100;
const DB = process.env.TEST_DATABASE_URL ?? "postgresql://fixrelay:fixrelay@localhost:5432/fixrelay_test";

/** End-to-end tests run against a production build talking to the TEST database. Run `npm run build` first. */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", screenshot: "only-on-failure" },
  webServer: {
    command: `npx prisma migrate deploy && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: DB, APP_URL: `http://localhost:${PORT}`, STORAGE_DRIVER: "db", BCRYPT_COST: "6", TRUSTED_PROXY_HOPS: "1", ...(process.env.CLAMAV_TEST_PORT ? { CLAMAV_HOST: "127.0.0.1", CLAMAV_PORT: process.env.CLAMAV_TEST_PORT } : {}) },
  },
});
