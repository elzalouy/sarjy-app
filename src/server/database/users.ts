import "server-only";
import type {
  AccountStatus,
  PrismaClient,
} from "../../generated/prisma/client.ts";
import { normalizePhoneNumber } from "../shared/phone-number.ts";

const userSelect = {
  id: true,
  phoneNumber: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type StoredUser = {
  id: string;
  phoneNumber: string;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type LoginUserRecord = StoredUser & {
  passwordHash: string;
};

export async function findUserByPhone(
  prisma: PrismaClient,
  phone: string,
): Promise<StoredUser | null> {
  const phoneNumber = normalizePhoneNumber(phone);
  return prisma.user.findUnique({
    where: { phoneNumber },
    select: userSelect,
  });
}

export async function findUserForLogin(
  prisma: PrismaClient,
  phone: string,
): Promise<LoginUserRecord | null> {
  const phoneNumber = normalizePhoneNumber(phone);
  return prisma.user.findUnique({
    where: { phoneNumber },
    select: {
      ...userSelect,
      passwordHash: true,
    },
  });
}

export async function createUser(
  prisma: PrismaClient,
  input: {
    phoneNumber: string;
    passwordHash: string;
  },
): Promise<StoredUser> {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  return prisma.user.create({
    data: {
      phoneNumber,
      passwordHash: input.passwordHash,
      status: "active",
    },
    select: userSelect,
  });
}
