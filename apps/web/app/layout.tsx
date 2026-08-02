import "@mantine/core/styles.css";
import "./globals.css";

import { ColorSchemeScript, mantineHtmlProps } from "@mantine/core";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { palette } from "../lib/brand/palette";
import { fontVariables } from "../lib/fonts";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Growthmind",
  description: "Build a product people actually use — then use again.",
};

export const viewport: Viewport = {
  themeColor: palette.paper,
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" {...mantineHtmlProps} className={fontVariables}>
      <head>
        <ColorSchemeScript defaultColorScheme="dark" />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
