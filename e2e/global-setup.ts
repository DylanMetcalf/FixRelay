import { PrismaClient } from "@prisma/client";

/** E2E runs against the test database. Clear rate-limit windows left by earlier runs (they are time-based). */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://fixrelay:fixrelay@localhost:5432/fixrelay_test";
  if (!/test/.test(new URL(url).pathname)) throw new Error("E2E must use a database whose name contains 'test'.");
  const db = new PrismaClient({ datasourceUrl: url });
  await db.rateLimit.deleteMany({});
  await db.$disconnect();
}
