import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer } from "../../../components/page-container.tsx";
import { RegisterForm } from "../../../features/auth/register-form.tsx";
import { redirectIfSignedIn } from "../redirect-if-signed-in.ts";

export const metadata: Metadata = {
  title: "Create account",
};

export default async function RegisterPage() {
  await redirectIfSignedIn();

  return (
    <PageContainer title="Create account">
      <RegisterForm />
      <p className="ui-links">
        Already registered? <Link href="/login">Log in</Link>
      </p>
    </PageContainer>
  );
}
