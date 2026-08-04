"use client";

import { Button, Code, CopyButton, Group, VisuallyHidden } from "@mantine/core";
import { useId } from "react";

import { ONBOARDING_MESSAGES } from "@growthmind/shared";

import { tapTargetStyle } from "./tap-target";

interface CopyableCommandProps {
  readonly command: string;

  // Required, not optional: two adjacent buttons both announcing "Copy" are
  // indistinguishable by ear, and an optional name is one that gets forgotten.
  readonly copyLabel: string;

  // The name above is fixed, so the visible `Copy` → `Copied` swap announces
  // nothing; a page that wants a reader told feeds its own live region from here.
  readonly onCopied?: () => void;
}

// A command a person is expected to run somewhere else. Reading it off the screen
// and retyping it is where the typo comes from, so the copy is one press.
export function CopyableCommand(props: CopyableCommandProps) {
  const labelId = useId();

  return (
    <Group gap="xs" wrap="nowrap" align="stretch">
      <VisuallyHidden id={labelId}>{props.copyLabel}</VisuallyHidden>

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
          <Button
            variant="default"
            size="compact-sm"
            onClick={() => {
              copy();
              props.onCopied?.();
            }}
            aria-labelledby={labelId}
            style={tapTargetStyle}
          >
            {copied ? ONBOARDING_MESSAGES.copied : ONBOARDING_MESSAGES.copy}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
}
