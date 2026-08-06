"use client";

import { Anchor, type AnchorProps, Button, type ButtonProps } from "@mantine/core";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type LinkHref = ComponentProps<typeof Link>["href"];

// target/rel aren't part of Mantine's own AnchorProps — they only reach the rendered <a>
// through prop spreading, so a new-tab link (e.g. a citation opening a recording) needs
// them named explicitly to typecheck.
interface NewTabAttrs {
  readonly target?: "_blank";
  readonly rel?: string;
}

export function AnchorLink({
  href,
  children,
  ...props
}: AnchorProps & NewTabAttrs & { href: LinkHref; children: ReactNode }) {
  return (
    <Anchor component={Link} href={href} {...props}>
      {children}
    </Anchor>
  );
}

export function ButtonLink({
  href,
  children,
  ...props
}: ButtonProps & { href: LinkHref; children: ReactNode }) {
  return (
    <Button component={Link} href={href} {...props}>
      {children}
    </Button>
  );
}
