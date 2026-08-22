/**
 * One PrismaClient for the whole process.
 *
 * Each route file used to construct its own, which multiplies connection pools
 * against a single small Postgres. The global cache also survives Next's
 * dev-mode hot reload, which otherwise leaks a client per edit until the
 * database refuses new connections.
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
