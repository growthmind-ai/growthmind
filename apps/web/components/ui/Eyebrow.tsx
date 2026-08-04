import { Text, type TextProps } from "@mantine/core";
import type { ReactNode } from "react";

interface EyebrowProps extends TextProps {
  readonly children: ReactNode;
}

export function Eyebrow({ children, ...props }: EyebrowProps) {
  return (
    <Text size="xs" fw={700} tt="uppercase" c="dimmed" {...props}>
      {children}
    </Text>
  );
}

interface LeadInProps extends TextProps {
  readonly label: string;
  readonly children: ReactNode;
}

/** A labelled sentence: the label is bold and inline, so the line still reads as prose. */
export function LeadIn({ label, children, ...props }: LeadInProps) {
  return (
    <Text {...props}>
      <Text span fw={700}>
        {label}:{" "}
      </Text>
      {children}
    </Text>
  );
}
