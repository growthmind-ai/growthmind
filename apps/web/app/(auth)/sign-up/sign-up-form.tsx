"use client";

import { Anchor, Button, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { signUp } from "@/lib/auth-client";
import {
  clearField,
  DUPLICATE_EMAIL,
  EMAIL_PLACEHOLDER,
  NAME_PLACEHOLDER,
  NEW_PASSWORD_PLACEHOLDER,
  NO_SIGN_UP_ERRORS,
  signUpSubmitErrors,
  validateSignUp,
  type SignUpErrors,
} from "@/lib/auth-forms";
import { ROUTES } from "@/lib/routes";

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
      const { error } = await signUp.email(validation.values);

      if (!error) {
        router.push(ROUTES.home);
        return;
      }

      setErrors(signUpSubmitErrors(error));
    } catch (error) {
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
          placeholder={NAME_PLACEHOLDER}
          value={name}
          onChange={(event) => {
            setName(event.currentTarget.value);

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
          placeholder={EMAIL_PLACEHOLDER}
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
          placeholder={NEW_PASSWORD_PLACEHOLDER}
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
