/**
 * Idempotent seed: default plans, and (optionally) the platform operator account.
 *   PLATFORM_ADMIN_EMAIL=you@example.com PLATFORM_ADMIN_PASSWORD='a long password' npm run db:seed
 * No sample tenant data is seeded here — demo data lives only in explicit demo workspaces.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const plans = [
    { code: "trial", name: "Trial", maxUsers: 5, maxActiveJobs: 50, maxSites: 3 },
    { code: "starter", name: "Starter", maxUsers: 10, maxActiveJobs: 300, maxSites: 5 },
    { code: "professional", name: "Professional", maxUsers: 50, maxActiveJobs: null, maxSites: null },
  ];
  for (const p of plans) await prisma.plan.upsert({ where: { code: p.code }, update: {}, create: p });
  console.log("Plans ensured.");

  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (email && password) {
    if (password.length < 12) throw new Error("PLATFORM_ADMIN_PASSWORD must be at least 12 characters.");
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.upsert({
      where: { email }, update: { isPlatformAdmin: true },
      create: { email, name: "Platform Operator", passwordHash, isPlatformAdmin: true },
    });
    console.log(`Platform operator ensured: ${email}`);
  }
}
main().finally(() => prisma.$disconnect());
