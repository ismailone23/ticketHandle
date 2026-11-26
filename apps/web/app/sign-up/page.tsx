"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard } from "@/components/auth-card";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Spinner } from "@/components/ui/spinner";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "@/lib/format";

function SignUpForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [step, setStep] = useState<"details" | "code">("details");
  const [creds, setCreds] = useState({ email: "", password: "" });
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function createAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setPending(true);
    setError(null);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name")),
      email,
      password,
    });
    setPending(false);
    if (error) return setError(error.message ?? "Couldn't create the account");
    setCreds({ email, password });
    setStep("code");
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const verified = await authClient.emailOtp.verifyEmail({
      email: creds.email,
      otp,
    });
    if (verified.error) {
      setPending(false);
      return setError(verified.error.message ?? "That code didn't work");
    }
    const signedIn = await authClient.signIn.email(creds);
    setPending(false);
    if (signedIn.error) return router.push("/sign-in");
    router.push(next);
  }

  if (step === "code")
    return (
      <AuthCard
        title="Check your email"
        description={`We sent a 6-digit code to ${creds.email}. It expires in 5 minutes.`}
      >
        <form onSubmit={verify}>
          <FieldGroup>
            <Field data-invalid={!!error || undefined}>
              <FieldLabel htmlFor="otp">Verification code</FieldLabel>
              <InputOTP
                id="otp"
                maxLength={6}
                value={otp}
                onChange={setOtp}
                aria-invalid={!!error || undefined}
              >
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <Button type="submit" disabled={pending || otp.length < 6}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              Verify and continue
            </Button>
          </FieldGroup>
        </form>
      </AuthCard>
    );

  return (
    <AuthCard
      title="Create an account"
      description="We'll email you a code to confirm it's you."
      footer={
        <span>
          Already registered?{" "}
          <Link
            href={`/sign-in?next=${encodeURIComponent(next)}`}
            className="text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </span>
      }
    >
      <form onSubmit={createAccount}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="name">Full name</FieldLabel>
            <Input id="name" name="name" autoComplete="name" required />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
            />
          </Field>
          <Field data-invalid={!!error || undefined}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              aria-invalid={!!error || undefined}
            />
            <FieldDescription>At least 8 characters.</FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Create account
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
