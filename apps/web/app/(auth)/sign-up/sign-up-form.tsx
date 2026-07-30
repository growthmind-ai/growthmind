"use client";

import { Anchor, Button, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { signUpSchema } from "@growthmind/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { signUp } from "@/lib/auth-client";
import { ROUTES } from "@/lib/routes";

// Copy is normative (UX spec §3, First-Run Checklist rows 3-5) — shipped
// verbatim. Never surface a raw Zod message or a Better Auth error code.
const PENDING_LABEL = "Creating your workspace…";
const SHORT_PASSWORD_MESSAGE = "Passwords need at least 8 characters.";
const NETWORK_FAILURE_MESSAGE = "Couldn't reach the server — check your connection and try again.";

/**
 * Better Auth surfaces the machine-readable failure reason on
 * `error.body.code` (confirmed against the server-side `APIError` shape
 * pinned by `apps/web/__tests__/tenancy/signup-org.test.ts`). Read
 * defensively via `unknown` — the client fetch wrapper's error type is a
 * loose `Record<string, any>` union, and a top-level `.code` is also
 * accepted in case the client normalizes the shape differently than the
 * server-side throw.
 */
function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const body = (error as { body?: unknown }).body;
  if (body && typeof body === "object") {
    const bodyCode = (body as { code?: unknown }).code;
    if (typeof bodyCode === "string") {
      return bodyCode;
    }
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

type EmailError = "duplicate" | string | null;

export function SignUpForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<EmailError>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPending) {
      // Belt: the button + fields are also disabled while pending, so this
      // guards only a synthetic/programmatic re-submit (D6 note, UX §2).
      return;
    }

    setFormError(null);
    setNameError(null);
    setEmailError(null);
    setPasswordError(null);

    const parsed = signUpSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "password") {
          setPasswordError(SHORT_PASSWORD_MESSAGE);
        } else if (field === "email") {
          setEmailError((current) => current ?? issue.message);
        } else if (field === "name") {
          setNameError((current) => current ?? issue.message);
        }
      }
      return;
    }

    setIsPending(true);
    try {
      const { error } = await signUp.email({
        name: parsed.data.name,
        email: parsed.data.email,
        password: parsed.data.password,
      });

      if (!error) {
        router.push(ROUTES.home);
        return;
      }

      const code = readErrorCode(error);
      if (code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
        setEmailError("duplicate");
      } else if (code === "PASSWORD_TOO_SHORT") {
        setPasswordError(SHORT_PASSWORD_MESSAGE);
      } else {
        // Unknown/malformed failure and genuine network failure land on the
        // same plain-English message — neither a raw message nor a code
        // ever reaches the screen.
        setFormError(NETWORK_FAILURE_MESSAGE);
      }
    } catch {
      setFormError(NETWORK_FAILURE_MESSAGE);
    } finally {
      setIsPending(false);
    }
  }

  const emailErrorNode: ReactNode =
    emailError === "duplicate" ? (
      <>
        That email is already in use —{" "}
        <Anchor component={Link} href={ROUTES.signIn} size="xs">
          sign in instead?
        </Anchor>
      </>
    ) : (
      emailError
    );

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Stack gap="md">
        <TextInput
          label="Your name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          error={nameError}
          disabled={isPending}
          autoComplete="name"
        />
        <TextInput
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          error={emailErrorNode}
          disabled={isPending}
          autoComplete="email"
        />
        <PasswordInput
          label="Password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          error={passwordError}
          disabled={isPending}
          autoComplete="new-password"
        />
        {formError ? (
          <Text size="sm" c="red">
            {formError}
          </Text>
        ) : null}
        <Button type="submit" fullWidth loading={isPending}>
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
