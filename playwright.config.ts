import { defineConfig } from "@playwright/test";

const PORT = 3100;
const DB = process.env.TEST_DATABASE_URL ?? "postgresql://fixrelay:fixrelay@localhost:5432/fixrelay_test";

/** End-to-end tests run against a production build talking to the TEST database. Run `npm run build` first. */
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", screenshot: "only-on-failure" },
  webServer: {
    command: `npx prisma migrate deploy && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL: DB, APP_URL: `http://localhost:${PORT}`, STORAGE_DIR: "./.storage-test", BCRYPT_COST: "6" },
  },
});
