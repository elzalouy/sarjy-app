import "server-only";
import type { AccountStatus } from "../../generated/prisma/client.ts";

export type PublicUser = {
  id: string;
  phoneNumber: string;
  status: AccountStatus;
};

export function toPublicUser(user: {
  id: string;
  phoneNumber: string;
  status: AccountStatus;
}): PublicUser {
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    status: user.status,
  };
}
