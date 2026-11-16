import { PrismaClient, Prisma } from "@prisma/client";

const g = globalThis as unknown as { __prisma?: PrismaClient };
export const prisma = g.__prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;

/** Either the root client or a transaction client. Services accept this so they compose. */
export type Db = PrismaClient | Prisma.TransactionClient;
export type Tx = Prisma.TransactionClient;
