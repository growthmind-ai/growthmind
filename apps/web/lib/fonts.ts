import { Courier_Prime, IBM_Plex_Mono, Jost } from "next/font/google";

/**
 * The brand's three families, self-hosted via next/font — the same trio the
 * marketing site uses. Each is exposed as a CSS variable; the Mantine theme
 * (lib/theme.ts) and app/globals.css wrap them in stacks with fallbacks, so a
 * family can be swapped here without touching a stylesheet.
 */

const jost = Jost({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-geo",
  display: "swap",
});

const courierPrime = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-type",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

/** Apply to `<html>` to publish every font variable to the document. */
export const fontVariables = [jost.variable, courierPrime.variable, plexMono.variable].join(" ");
