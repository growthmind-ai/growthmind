"use client";

import { Paper, Stack, Text } from "@mantine/core";

import { ButtonLink } from "@/components/ui/Links";
import { signInHref } from "@/lib/auth-forms";

export const DUPLICATE_ACCOUNT_TITLE = "You already have an account with us";

interface DuplicateAccountNoticeProps {
  readonly email: string;
}

export function DuplicateAccountNotice({ email }: DuplicateAccountNoticeProps) {
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text fw={600} size="sm">
          {DUPLICATE_ACCOUNT_TITLE}
        </Text>
        <Text size="sm" c="dimmed" style={{ wordBreak: "break-word" }}>
          {email} is already registered. Sign in with your password — there is no need to create a
          second account.
        </Text>
        <ButtonLink href={signInHref(email)} size="md" fullWidth>
          Sign in instead
        </ButtonLink>
      </Stack>
    </Paper>
  );
}
