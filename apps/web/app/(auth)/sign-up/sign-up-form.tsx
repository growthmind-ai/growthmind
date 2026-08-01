"use client";

import { Anchor, Button, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { signUp } from "@/lib/auth-client";
import {
  clearField,
  DUPLICATE_EMAIL,
  NO_SIGN_UP_ERRORS,
  signUpSubmitErrors,
  validateSignUp,
  type SignUpErrors,
} from "@/lib/auth-forms";
import { ROUTES } from "@/lib/routes";

// EVERY SENTENCE THIS FORM CAN SHOW LIVES IN `lib/auth-forms.ts`, WITH ITS TESTS.
// This file renders what those functions return and decides nothing — no Zod
// issue is read here, no Better Auth code is read here, and neither is ever
// rendered. Copy is normative (UX spec, First-Run Checklist rows 3-5).
const PENDING_LABEL = "Creating your workspace…";

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<SignUpErrors>(NO_SIGN_UP_ERRORS);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) {
      // Belt: the button + fields are also disabled while pending, so this guards only
      // a synthetic/programmatic re-submit (note, UX).
      return;
    }

    const validation = validateSignUp({ name, email, password });
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }

    setErrors(NO_SIGN_UP_ERRORS);
    setIsPending(true);
    try {
      // The validator's own output — `name` arrives trimmed, and nothing here
      // re-normalises it a second, slightly different way.
      const { error } = await signUp.email(validation.values);

      if (!error) {
        router.push(ROUTES.home);
        return;
      }

      setErrors(signUpSubmitErrors(error));
    } catch (error) {
      // A rejected fetch has no code, so this lands on the same network sentence
      // an unrecognised failure does — one mapping, one place, either way in.
      setErrors(signUpSubmitErrors(error));
    } finally {
      setIsPending(false);
    }
  }

  const emailErrorNode: ReactNode =
    errors.email === DUPLICATE_EMAIL ? (
      <>
        That email is already in use —{" "}
        <Anchor component={Link} href={ROUTES.signIn} size="xs">
          sign in instead?
        </Anchor>
      </>
    ) : (
      errors.email
    );

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack gap="md">
        <TextInput
          label="Your name"
          size="md"
          value={name}
          onChange={(event) => {
            setName(event.currentTarget.value);
            // The error describes a submission the user is now editing away from.
            setErrors((current) => clearField(current, "name"));
          }}
          error={errors.name}
          disabled={isPending}
          autoComplete="name"
        />
        <TextInput
          label="Email"
          type="email"
          size="md"
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);
            setErrors((current) => clearField(current, "email"));
          }}
          error={emailErrorNode}
          disabled={isPending}
          autoComplete="email"
        />
        <PasswordInput
          label="Password"
          size="md"
          value={password}
          onChange={(event) => {
            setPassword(event.currentTarget.value);
            setErrors((current) => clearField(current, "password"));
          }}
          error={errors.password}
          disabled={isPending}
          autoComplete="new-password"
        />
        {errors.form ? (
          <Text size="sm" c="red">
            {errors.form}
          </Text>
        ) : null}
        <Button type="submit" size="md" fullWidth loading={isPending}>
          {isPending ? PENDING_LABEL : "Create account"}
        </Button>
        <Text size="sm" ta="center">
          Already have an account?{" "}
          <Anchor component={Link} href={ROUTES.signIn}>
            Sign in
          </Anchor>
        </Text>
      </Stack>
    </form>
  );
}
