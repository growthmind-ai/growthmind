"use client";

import { ActionIcon, Indicator, Popover } from "@mantine/core";
import { bellAriaLabel } from "@growthmind/shared";
import { useState } from "react";

import type { BellViewModel } from "@/lib/notifications/bell";

import { BellPopoverBody } from "./BellPopover";

export interface BellProps {
  readonly bell: BellViewModel | null;

  // Which shell slot this instance fills; exactly one is visible at any width, so the two
  // can never both open a popover.
  readonly placement: "rail" | "bar";
}

// Opening clears the badge, closing clears it again: a row arriving while the popover is
// open would otherwise come back as a count of something already on screen (ADD D-3).
function stampOpened(): void {
  void fetch("/api/notifications/bell/opened", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => undefined);
}

export function Bell({ bell, placement }: BellProps) {
  const [opened, setOpened] = useState(false);

  if (bell === null) {
    return null;
  }

  const label = bellAriaLabel(bell.badgeCount);

  return (
    <Popover
      opened={opened}
      onChange={(next) => {
        setOpened(next);
        stampOpened();
      }}
      position={placement === "rail" ? "bottom-start" : "bottom-end"}
      withArrow
      shadow="md"
      radius="sm"
    >
      <Popover.Target>
        <Indicator
          label={bell.badgeLabel}
          size={16}
          disabled={bell.badgeCount === 0}
          color="band.4"
          offset={4}
        >
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={label}
            {...(placement === "rail"
              ? { visibleFrom: "sm" as const }
              : { hiddenFrom: "sm" as const })}
            onClick={() => {
              setOpened((was) => !was);
              stampOpened();
            }}
          >
            <BellGlyph />
          </ActionIcon>
        </Indicator>
      </Popover.Target>

      <Popover.Dropdown p={0}>
        <BellPopoverBody bell={bell} />
      </Popover.Dropdown>
    </Popover>
  );
}

function BellGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M10 18a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
