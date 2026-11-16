import { execSync } from "node:child_process";

/**
 * Applies pending migrations to the dedicated test database (non-destructive `migrate deploy`).
 * The database is NOT wiped between runs: every test creates its own tenant, which also exercises isolation.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://fixrelay:fixrelay@localhost:5432/fixrelay_test";
  if (!/test/.test(new URL(url).pathname)) throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'.");
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
