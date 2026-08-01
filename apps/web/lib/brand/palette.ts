/**
 * The Growthmind brand palette. The one place a brand colour is written down in this
 * app. Mirrors the marketing site's palette (growthmind.ai) so the app and the site
 * read as one product.
 *
 * Everything that needs a raw brand value derives from here:
 * Lib/theme.ts the Mantine theme (colour tuples, autoContrast)
 * App/layout.tsx browser chrome tint
 * App/globals.css custom properties for the few places CSS needs them
 *
 * Components never reference these hexes directly. They consume Mantine's semantic
 * tokens (see the theme), so a re-skin is an edit here, not a sweep through every
 * component.
 */
export const palette = {
  /** Page background, the memo's paper stock. */
  paper: "#191e19",
  /** Card / surface background. */
  sheet: "#212721",
  /** Slightly recessed surface. */
  sheet2: "#1d231d",
  /** Body text. */
  ink: "#e9ede4",
  /** Secondary / muted text. */
  soft: "#adb8a8",
  /** The brand green, accents, CTAs, the trailing chevron. */
  band: "#a9c4a2",
  /** Text set on a band-coloured surface. */
  onband: "#161c16",
  /** The rust stamp accent. Sparing, for verdicts and warnings. */
  stamp: "#c05a3a",
  /** Tertiary text / disabled. */
  grey: "#78826f",
  /** Hairline borders. */
  hair: "rgba(233, 237, 228, 0.14)",
} as const;
