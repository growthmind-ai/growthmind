import { Text } from "@mantine/core";
import type { ReactNode } from "react";

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
