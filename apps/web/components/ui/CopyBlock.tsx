"use client";

import { Button, CopyButton } from "@mantine/core";

import { ONBOARDING_MESSAGES } from "@growthmind/shared";

import { tapTargetStyle } from "./tap-target";

interface CopyBlockProps {
  readonly value: string;
  readonly label: string;
}

// A block of text meant to leave this screen and be pasted somewhere else. Unlike
// `CopyableCommand` it never shows what it holds — the page above it already did.
export function CopyBlock({ value, label }: CopyBlockProps) {
  return (
    <CopyButton value={value}>
      {({ copied, copy }) => (
        <Button variant="default" size="compact-sm" onClick={copy} style={tapTargetStyle}>
          {copied ? ONBOARDING_MESSAGES.copied : label}
        </Button>
      )}
    </CopyButton>
  );
}
