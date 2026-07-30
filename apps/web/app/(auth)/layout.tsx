import { Center, Container } from "@mantine/core";
import type { ReactNode } from "react";

/**
 * Shared shell for the auth route group (ADD D-H / UX §3): a single ~400px
 * column, vertically centered in the viewport. Sign-in and sign-up render
 * inside this without inheriting any future authenticated app chrome —
 * that's the whole reason this route group exists.
 *
 * `px={0}` on the Container: the outer `Center`'s own padding already gives
 * narrow viewports a gutter, so the container itself stays exactly `maw`
 * wide instead of doubling up on horizontal padding.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Center mih="100dvh" p="md">
      <Container maw={400} w="100%" px={0}>
        {children}
      </Container>
    </Center>
  );
}
