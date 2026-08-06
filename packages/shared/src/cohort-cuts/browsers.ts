import { matchesToken } from "../exclusions/automation";

export const BROWSER_FAMILIES = [
  "safari",
  "chrome",
  "firefox",
  "edge",
  "other",
  "unknown",
] as const;

export type BrowserFamily = (typeof BROWSER_FAMILIES)[number];

export const EDGE_TOKENS: readonly string[] = ["edg", "edga", "edgios"];

export const LONG_TAIL_BROWSER_TOKENS: readonly string[] = [
  "opr",
  "opera",
  "samsungbrowser",
  "ucbrowser",
  "yabrowser",
  "brave",
  "vivaldi",
  "duckduckgo",
  "silk",
  "qqbrowser",
  "miuibrowser",
  "huaweibrowser",
  "whale",
  "maxthon",
  "puffin",
];

export const CHROME_TOKENS: readonly string[] = ["chrome", "crios"];

export const FIREFOX_TOKENS: readonly string[] = ["firefox", "fxios"];

export const SAFARI_TOKENS: readonly string[] = ["safari"];

export function classifyBrowserFamily(userAgent: string | null | undefined): BrowserFamily {
  const trimmed = userAgent?.trim() ?? "";

  // Gate order is load-bearing: a long-tail Chromium UA carries the Chrome token, every Chrome UA
  // carries the Safari token, and every Edge UA carries both.
  if (firesAny(trimmed, EDGE_TOKENS)) return "edge";

  if (firesAny(trimmed, LONG_TAIL_BROWSER_TOKENS)) return "other";

  if (firesAny(trimmed, CHROME_TOKENS)) return "chrome";

  if (firesAny(trimmed, FIREFOX_TOKENS)) return "firefox";

  if (firesAny(trimmed, SAFARI_TOKENS)) return "safari";

  return "unknown";
}

function firesAny(userAgent: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => matchesToken(userAgent, token));
}
