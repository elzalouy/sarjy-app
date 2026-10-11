"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { endSession } from "../../server/auth/end-session.ts";
import { getServerConfig } from "../../server/config/env.ts";

export async function signOut(): Promise<void> {
  const config = getServerConfig();
  const store = await cookies();
  const token = store.get(config.session.cookieName)?.value ?? null;
  await endSession(token);
  store.set(config.session.cookieName, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  redirect("/login");
}
