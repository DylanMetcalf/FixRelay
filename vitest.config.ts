import path from "node:path";
import { defineConfig } from "vitest/config";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://fixrelay:fixrelay@localhost:5432/fixrelay_test";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: "tests/global-setup.ts",
    testTimeout: 30_000,
    env: { DATABASE_URL: TEST_DB, BCRYPT_COST: "4", STORAGE_DIR: "./.storage-test", APP_URL: "http://test.local" },
  },
});
