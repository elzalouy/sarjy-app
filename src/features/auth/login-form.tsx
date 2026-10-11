"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "../../components/alert.tsx";
import { Button } from "../../components/button.tsx";
import { FormStack } from "../../components/form-stack.tsx";
import { LoadingIndicator } from "../../components/loading-indicator.tsx";
import { TextField } from "../../components/text-field.tsx";
import { formErrorsFromFailure, postCredentials } from "./auth-client.ts";
import {
  credentialIssues,
  hasCredentialIssues,
  livePasswordIssue,
  livePhoneIssue,
} from "./credentials.ts";

const phoneHint = "Include the country code, such as +1 415 555 2671.";

export function LoginForm() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: { preventDefault: () => void }): Promise<void> {
    event.preventDefault();
    const issues = credentialIssues(phone, password);
    setPhoneError(issues.phone);
    setPasswordError(issues.password);
    setFormError(undefined);
    if (hasCredentialIssues(issues) || pending) {
      return;
    }

    setPending(true);
    const result = await postCredentials("/api/v1/auth/login", {
      phone,
      password,
    });
    if (!result.ok) {
      setPending(false);
      const errors = formErrorsFromFailure(result);
      setPhoneError(errors.phone);
      setPasswordError(errors.password);
      setFormError(errors.form);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <FormStack
      onSubmit={(event) => {
        void onSubmit(event);
      }}
    >
      {formError ? <Alert tone="error">{formError}</Alert> : null}
      <TextField
        label="Phone number"
        name="phone"
        type="tel"
        value={phone}
        dir="ltr"
        autoComplete="tel"
        maxLength={32}
        hint={phoneHint}
        error={phoneError}
        disabled={pending}
        onChange={(value) => {
          if (value === phone) {
            return;
          }
          setPhone(value);
          setPhoneError(livePhoneIssue(value));
          setFormError(undefined);
        }}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        value={password}
        dir="ltr"
        autoComplete="current-password"
        maxLength={128}
        error={passwordError}
        disabled={pending}
        onChange={(value) => {
          if (value === password) {
            return;
          }
          setPassword(value);
          setPasswordError(livePasswordIssue(value));
          setFormError(undefined);
        }}
      />
      <Button type="submit" block disabled={pending} aria-busy={pending}>
        {pending ? (
          <>
            <LoadingIndicator label="Logging in" />
            Logging in…
          </>
        ) : (
          "Log in"
        )}
      </Button>
    </FormStack>
  );
}
