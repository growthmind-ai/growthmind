"use client";

import type { BellViewModel } from "../../lib/notifications/bell";

export interface BellPopoverProps {
  readonly bell: BellViewModel;
  readonly opened: boolean;
  readonly onClose: () => void;
}

export function BellPopover(_props: BellPopoverProps) {
  return null;
}
