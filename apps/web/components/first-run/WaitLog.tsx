"use client";

import { Text } from "@mantine/core";
import { useRef } from "react";

import type { StageLogLine } from "@growthmind/shared";

import styles from "./first-run.module.css";

const lineClass = (index: number, replayed: number): string =>
  index >= replayed ? `${styles.line} ${styles.appear}` : styles.line;

interface WaitLogProps {
  readonly lines: readonly StageLogLine[];
}

export function WaitLog({ lines }: WaitLogProps) {
  const replayed = useRef(lines.length);

  return (
    <ol aria-live="polite" aria-relevant="additions" className={styles.log}>
      {lines.map((line, index) => (
        <li key={line.text} className={lineClass(index, replayed.current)}>
          <Text span size="sm" c="dimmed" className={styles.stamp}>
            +{line.atSeconds}s
          </Text>
          <Text span size="sm">
            {line.text}
          </Text>
        </li>
      ))}
    </ol>
  );
}
