"use client";

import { Anchor, Button, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { signIn } from "@/lib/auth-client";
import {
  clearField,
  NO_SIGN_IN_ERRORS,
  signInSubmitErrors,
  validateSignIn,
  type SignInErrors,
} from "@/lib/auth-forms";
import { ROUTES } from "@/lib/routes";

const PENDING_LABEL = "Signing you in…";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<SignInErrors>(NO_SIGN_IN_ERRORS);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) {
      return;
    }

    const validation = validateSignIn({ email, password });
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }

    setErrors(NO_SIGN_IN_ERRORS);
    setIsPending(true);
    try {
      const { error } = await signIn.email(validation.values);

      if (!error) {
        router.push(ROUTES.home);
        return;
      }

      setErrors(signInSubmitErrors(error));
    } catch (error) {
      setErrors(signInSubmitErrors(error));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack gap="md">
        <TextInput
          label="Email"
          type="email"
          size="md"
          value={email}
          onChange={(event) => {
            setEmail(event.currentTarget.value);

            setErrors((current) => clearField(current, "email"));
          }}
          error={errors.email}
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
          autoComplete="current-password"
        />
        {errors.form ? (
          <Text size="sm" c="red">
            {errors.form}
          </Text>
        ) : null}
        <Button type="submit" size="md" fullWidth loading={isPending}>
          {isPending ? PENDING_LABEL : "Sign in"}
        </Button>
        {/* The open-source imprint moved to the route group's layout — it
            belongs to both pages, and one copy is one place to change it. */}
        <Text size="sm" ta="center">
          New here?{" "}
          <Anchor component={Link} href={ROUTES.signUp}>
            Create an account
          </Anchor>
        </Text>
      </Stack>
    </form>
  );
}
