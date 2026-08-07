"use client";

import type { BellViewModel } from "../../lib/notifications/bell";

export interface BellProps {
  readonly bell: BellViewModel | null;

  // Which shell slot this instance fills; exactly one is visible at any width.
  readonly placement: "rail" | "bar";
}

export function Bell(_props: BellProps) {
  return null;
}
