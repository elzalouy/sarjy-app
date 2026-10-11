import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "../../../components/alert.tsx";
import { PageContainer } from "../../../components/page-container.tsx";
import { LoginForm } from "../../../features/auth/login-form.tsx";
import { redirectIfSignedIn } from "../redirect-if-signed-in.ts";

export const metadata: Metadata = {
  title: "Log in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string | string[] }>;
}) {
  await redirectIfSignedIn();
  const params = await searchParams;
  const registered = params.registered === "1";

  return (
    <PageContainer title="Log in">
      {registered ? (
        <Alert tone="info">Account created. Log in to continue.</Alert>
      ) : null}
      <LoginForm />
      <p className="ui-links">
        New here? <Link href="/register">Create an account</Link>
      </p>
    </PageContainer>
  );
}
