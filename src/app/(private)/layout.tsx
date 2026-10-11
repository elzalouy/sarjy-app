import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AccountBar } from "../../features/auth/account-bar.tsx";
import { readSessionUser } from "../../server/auth/read-session-user.ts";
import { getServerConfig } from "../../server/config/env.ts";
import { signOut } from "./sign-out.ts";

export default async function PrivateLayout({
  children,
}: {
  children: ReactNode;
}) {
  const config = getServerConfig();
  const token = (await cookies()).get(config.session.cookieName)?.value ?? null;
  const user = await readSessionUser(token);
  if (user === null) {
    redirect("/login");
  }

  return (
    <>
      <AccountBar phoneNumber={user.phoneNumber} signOutAction={signOut} />
      {children}
    </>
  );
}
