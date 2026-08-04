"use client";

import { Button, Code, CopyButton, Stack } from "@mantine/core";

import { ONBOARDING_MESSAGES } from "@growthmind/shared";

import { tapTargetStyle } from "./tap-target";

interface CopyableBlockProps {
  readonly block: string;

  // Required, not optional: two adjacent buttons both announcing "Copy" are
  // indistinguishable by ear, and an optional name is one that gets forgotten.
  readonly copyLabel: string;
}

export function CopyableBlock(props: CopyableBlockProps) {
  return (
    <Stack gap="xs">
      <Code block fz="sm" style={{ maxWidth: "100%", overflowX: "auto", whiteSpace: "pre" }}>
        {props.block}
      </Code>

      <CopyButton value={props.block}>
        {({ copied, copy }) => (
          <Button
            variant="default"
            size="compact-sm"
            onClick={copy}
            aria-label={props.copyLabel}
            style={tapTargetStyle}
            w={{ base: "100%", xs: "auto" }}
          >
            {copied ? ONBOARDING_MESSAGES.copied : ONBOARDING_MESSAGES.copy}
          </Button>
        )}
      </CopyButton>
    </Stack>
  );
}
