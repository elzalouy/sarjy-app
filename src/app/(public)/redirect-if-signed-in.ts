import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerConfig } from "../../server/config/env.ts";
import { readSessionUser } from "../../server/auth/read-session-user.ts";

export async function redirectIfSignedIn(): Promise<void> {
  const config = getServerConfig();
  const token = (await cookies()).get(config.session.cookieName)?.value ?? null;
  const user = await readSessionUser(token);
  if (user !== null) {
    redirect("/");
  }
}
