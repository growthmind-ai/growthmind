"use client";

import { Anchor, type AnchorProps, Button, type ButtonProps } from "@mantine/core";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type LinkHref = ComponentProps<typeof Link>["href"];

export function AnchorLink({
  href,
  children,
  ...props
}: AnchorProps & { href: LinkHref; children: ReactNode }) {
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
