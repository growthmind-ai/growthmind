"use client";

import { Group, Stack, Text } from "@mantine/core";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { PREVIEW_TAB_GROUPS } from "@/lib/preview/tabs";

import classes from "./preview.module.css";

export function PreviewTabs() {
  const pathname = usePathname();

  return (
    <Stack gap={4} pb="xs">
      {PREVIEW_TAB_GROUPS.map((group) => (
        <Stack key={group.label} gap={2}>
          <Eyebrow mt={2}>{group.label}</Eyebrow>
          <Group gap={4} wrap="nowrap" className={classes.tabstrip}>
            {group.tabs.map((tab, index) => {
              // `startsWith` so a detail route keeps its own tab lit; `/seen` would otherwise
              // match every child of `/` and light the first tab everywhere.
              const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);

              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={classes.tab}
                  data-active={active || undefined}
                  data-quiet={group.numbered ? undefined : true}
                >
                  {group.numbered ? (
                    <Text span size="xs" c="dimmed" ff="monospace" mr={6}>
                      {String(index + 1).padStart(2, "0")}
                    </Text>
                  ) : null}
                  {tab.label}
                </Link>
              );
            })}
          </Group>
        </Stack>
      ))}
    </Stack>
  );
}
