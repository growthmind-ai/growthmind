import { Text } from "@mantine/core";
import type { ReactNode } from "react";

/**
 * The rubber-stamp label — the brand's device for a verdict pressed onto a
 * document (mirrors the marketing site's `components/ui/Stamp.tsx`).
 *
 * It owns what a stamp *looks* like — rust ink, a heavy box rule in the same
 * colour, tracked uppercase, set at an angle — and nothing about where it
 * sits. Positioning belongs to whatever surface is being stamped, so a caller
 * never has to fight this component's geometry; `MemoSheet` is the first
 * caller and places it against the masthead.
 */
export function Stamp({ children, rotate = -8 }: { children: ReactNode; rotate?: number }) {
  return (
    <Text
      component="span"
      c="stamp.5"
      fw={800}
      fz={12.5}
      lts="0.12em"
      tt="uppercase"
      style={{
        display: "inline-block",
        border: "2.5px solid currentColor",
        padding: "6px 11px",
        transform: `rotate(${rotate}deg)`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </Text>
  );
}
