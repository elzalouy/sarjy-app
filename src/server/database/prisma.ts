import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";
import { getServerConfig } from "../config/env";

let cached: PrismaClient | undefined;

export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      ssl: {
        rejectUnauthorized: false,
      },
    }),
  });
}

export function getPrismaClient(): PrismaClient {
  if (!cached) {
    cached = createPrismaClient(getServerConfig().database.url);
  }
  return cached;
}
