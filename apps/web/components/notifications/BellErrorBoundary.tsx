"use client";

import { logger } from "@growthmind/shared";
import { Component, type ReactNode } from "react";

// The bell lives in the layout on every page — the highest-blast-radius render in the
// app. A fault here degrades to no bell, never to a broken shell (ADD D-3, D5).
export class BellErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    logger.error("bell: the bell failed to render, so the shell is showing without it", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
