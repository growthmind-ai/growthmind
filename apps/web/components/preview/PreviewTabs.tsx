"use client";

import { Group, Text } from "@mantine/core";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { PREVIEW_TABS } from "@/lib/preview/tabs";

import classes from "./preview.module.css";

export function PreviewTabs() {
  const pathname = usePathname();

  return (
    <Group gap={4} wrap="nowrap" className={classes.tabstrip} pb="xs">
      {PREVIEW_TABS.map((tab, index) => {
        // `startsWith` so a detail route keeps its own tab lit; `/seen` would otherwise
        // match every child of `/` and light the first tab everywhere.
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);

        return (
          <Link key={tab.href} href={tab.href} className={classes.tab} data-active={active || undefined}>
            <Text span size="xs" c="dimmed" ff="monospace" mr={6}>
              {String(index + 1).padStart(2, "0")}
            </Text>
            {tab.label}
          </Link>
        );
      })}
    </Group>
  );
}
