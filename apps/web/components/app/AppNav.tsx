"use client";

import { Stack } from "@mantine/core";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Eyebrow } from "@/components/ui/Eyebrow";
import type { NavGroup } from "@/lib/app-nav";

import classes from "./app-shell.module.css";

// `startsWith` so a detail route keeps its parent lit — `/findings/f-04` is still Findings.
// Exact-match on "/" only, or the root would light on every page.
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Required, not optional: on mobile the navbar is an overlay, and a link that leaves it open
// over the page it just navigated to is the drawer bug every collapsed nav ships once.
interface AppNavProps {
  readonly groups: readonly NavGroup[];
  readonly onNavigate: () => void;
}

export function AppNav({ groups, onNavigate }: AppNavProps) {
  const pathname = usePathname();

  return (
    <Stack gap="lg" p="sm">
      {groups.map((group) => (
        <Stack key={group.label ?? "root"} gap={2}>
          {group.label === null ? null : (
            <Eyebrow px={10} pb={4}>
              {group.label}
            </Eyebrow>
          )}
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={classes.navLink}
              data-active={isActive(pathname, item.href) || undefined}
              onClick={onNavigate}
            >
              {item.label}
            </Link>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}
