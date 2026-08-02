"use client";

import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";

import { theme } from "@/lib/theme";

/** Owns the theme so its variantColorResolver never has to cross the server boundary. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="dark">
      {children}
    </MantineProvider>
  );
}
