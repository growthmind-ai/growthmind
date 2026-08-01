"use client";

import { Anchor, type AnchorProps, Button, type ButtonProps } from "@mantine/core";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Mantine's `Anchor`/`Button` rendered as a Next.js `Link`, from a SERVER component.
 *
 * ── WHY THIS FILE EXISTS. THE TRAP IS SILENT AND IT TOOK THE APP DOWN ────────
 *
 * `<Anchor component={Link}>` written directly inside a server component throws
 * at render:
 *
 *     Functions cannot be passed directly to Client Components unless you
 *     explicitly expose it by marking it with "use server".
 *
 * `Anchor` and `Button` are client components, and `component={Link}` passes a
 * FUNCTION across the server→client boundary. React cannot serialize it. The
 * failure is a 500 on the whole route, not a degraded link — and because the
 * signed-in landing page (`app/page.tsx`) is where signup redirects, it read as
 * "I can't create an account": the account committed correctly every time, then
 * `/` 500'd on arrival.
 *
 * The boundary moves in here. `href` is a string, `children` is serializable
 * markup, and `component={Link}` never crosses anything — it is already on the
 * client side of the line. A server component composes these exactly like any
 * other client component.
 *
 * ── WHEN NOT TO USE THEM ────────────────────────────────────────────────────
 *
 * Inside a component that is ALREADY `"use client"` (the auth forms), plain
 * `<Anchor component={Link}>` is correct and these wrappers buy nothing. This
 * file is for the server→client crossing specifically.
 */

/** `href` exactly as `next/link` accepts it — string or UrlObject. */
type LinkHref = ComponentProps<typeof Link>["href"];

/**
 * A Mantine `Anchor` that navigates client-side. Every Mantine style prop
 * (`c`, `underline`, `size`, …) passes through unchanged.
 */
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

/**
 * A Mantine `Button` that navigates client-side — a real control, not an anchor
 * styled to look like one, so it keeps the button's focus ring and tap target.
 */
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
