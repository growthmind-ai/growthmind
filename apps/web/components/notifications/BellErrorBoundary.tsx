"use client";

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
    console.error("bell: render failed, hiding the bell", error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
