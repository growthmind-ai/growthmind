import { Paper, type PaperProps } from "@mantine/core";
import type { ReactNode } from "react";

import classes from "./surface.module.css";

/** `accent` marks the card the eye should reach first; `highlight` marks a conclusion. */
export type SurfaceTone = "default" | "accent" | "highlight";

interface SurfaceCardProps extends PaperProps {
  readonly tone?: SurfaceTone;
  readonly children: ReactNode;
}

export function SurfaceCard({
  tone = "default",
  children,
  className,
  ...props
}: SurfaceCardProps) {
  return (
    <Paper
      withBorder
      radius="sm"
      p="md"
      bg={
        tone === "highlight"
          ? "var(--mantine-primary-color-light)"
          : "var(--mantine-color-default)"
      }
      className={[tone === "accent" ? classes.accent : null, className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {children}
    </Paper>
  );
}
