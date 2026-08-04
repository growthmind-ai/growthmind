"use client";

import { Box, Group, Menu, Text, UnstyledButton } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { organization } from "@/lib/auth-client";

import classes from "./app-shell.module.css";

export interface OrgOption {
  readonly id: string;
  readonly name: string;
}

interface OrgSwitcherProps {
  readonly organizations: readonly OrgOption[];
  readonly activeId: string;
  readonly activeName: string;
  readonly role: string;
}

function Label({ name, role }: { readonly name: string; readonly role: string }) {
  return (
    <Box style={{ flex: 1, minWidth: 0 }}>
      <Text size="sm" fw={600} truncate>
        {name}
      </Text>
      <Text size="xs" c="dimmed" truncate tt="capitalize">
        {role}
      </Text>
    </Box>
  );
}

// One organisation renders as a plain block, not a disabled control. A chevron that opens a
// menu saying "you are in one organisation" is a dead end wearing the costume of an action.
export function OrgSwitcher({ organizations, activeId, activeName, role }: OrgSwitcherProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  if (organizations.length <= 1) {
    return (
      <Group px="md" py="sm" gap="sm" wrap="nowrap">
        <Label name={activeName} role={role} />
      </Group>
    );
  }

  async function switchTo(organizationId: string): Promise<void> {
    if (organizationId === activeId) return;
    setPending(true);
    await organization.setActive({ organizationId });
    router.refresh();
    setPending(false);
  }

  return (
    <Menu position="bottom-start" width={232} withinPortal shadow="md">
      <Menu.Target>
        <UnstyledButton
          className={classes.accountButton}
          aria-label="Switch organisation"
          disabled={pending}
        >
          <Group gap="sm" wrap="nowrap">
            <Label name={activeName} role={role} />
            <Text size="xs" c="dimmed" aria-hidden>
              ⌄
            </Text>
          </Group>
        </UnstyledButton>
      </Menu.Target>

      <Menu.Dropdown>
        <Menu.Label>Your organisations</Menu.Label>
        {organizations.map((org) => (
          <Menu.Item
            key={org.id}
            onClick={() => void switchTo(org.id)}
            fw={org.id === activeId ? 700 : undefined}
          >
            {org.name}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
