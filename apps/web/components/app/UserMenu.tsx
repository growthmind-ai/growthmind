"use client";

import {
  Avatar,
  Box,
  Group,
  Menu,
  Text,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { signOut } from "@/lib/auth-client";
import { initialsOf } from "@/lib/initials";
import { ROUTES } from "@/lib/routes";

import classes from "./app-shell.module.css";

export interface Viewer {
  readonly name: string | null;
  readonly email: string | null;
  readonly organizationName: string;
}

export function UserMenu({ viewer }: { readonly viewer: Viewer }) {
  const router = useRouter();
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("dark", { getInitialValueInEffect: true });
  const [pending, setPending] = useState(false);

  const label = viewer.name?.trim() || viewer.email || "Your account";

  async function handleSignOut() {
    setPending(true);
    await signOut();
    router.push(ROUTES.signIn);
  }

  return (
    <Menu position="right-end" offset={4} width={232} withinPortal shadow="md">
      <Menu.Target>
        <UnstyledButton className={classes.accountButton} aria-label="Your account">
          <Group gap="sm" wrap="nowrap">
            <Avatar radius="xl" size={32} color="band" variant="light">
              <Text size="xs" fw={700}>
                {initialsOf(viewer.name, viewer.email)}
              </Text>
            </Avatar>
            <Box style={{ flex: 1, minWidth: 0 }}>
              <Text size="sm" fw={600} truncate>
                {label}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {viewer.organizationName}
              </Text>
            </Box>
            <Text size="xs" c="dimmed" aria-hidden>
              ⌃
            </Text>
          </Group>
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>{viewer.email ?? viewer.organizationName}</Menu.Label>
        <Menu.Item component={Link} href={ROUTES.account}>
          Your profile
        </Menu.Item>
        <Menu.Item component={Link} href={ROUTES.settings}>
          Settings
        </Menu.Item>

        <Menu.Divider />
        <Menu.Item onClick={() => setColorScheme(scheme === "dark" ? "light" : "dark")}>
          {scheme === "dark" ? "Switch to light" : "Switch to dark"}
        </Menu.Item>

        <Menu.Divider />
        <Menu.Item color="red" onClick={handleSignOut} disabled={pending}>
          {pending ? "Signing out…" : "Sign out"}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
