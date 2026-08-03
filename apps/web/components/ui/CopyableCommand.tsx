"use client";

import { Button, Code, CopyButton, Group } from "@mantine/core";

import { ONBOARDING_MESSAGES } from "@growthmind/shared";

import { tapTargetStyle } from "./tap-target";

interface CopyableCommandProps {
  readonly command: string;
}

// A command a person is expected to run somewhere else. Reading it off the screen
// and retyping it is where the typo comes from, so the copy is one press.
export function CopyableCommand(props: CopyableCommandProps) {
  return (
    <Group gap="xs" wrap="nowrap" align="stretch">
      <Code
        fz="sm"
        px="sm"
        py={8}
        style={{
          flex: 1,
          minWidth: 0,
          overflowX: "auto",
          whiteSpace: "nowrap",
          display: "flex",
          alignItems: "center",
        }}
      >
        {props.command}
      </Code>

      <CopyButton value={props.command}>
        {({ copied, copy }) => (
          <Button variant="default" size="compact-sm" onClick={copy} style={tapTargetStyle}>
            {copied ? ONBOARDING_MESSAGES.copied : ONBOARDING_MESSAGES.copy}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
}
