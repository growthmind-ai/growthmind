import { matchesToken } from "../exclusions/automation";

export const DEVICE_TYPES = ["mobile", "tablet", "desktop", "unknown"] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];

export const TABLET_TOKENS: readonly string[] = ["ipad", "tablet", "kindle", "silk", "playbook"];

export const ANDROID_TOKENS: readonly string[] = ["android"];

export const MOBILE_MARKER_TOKENS: readonly string[] = ["mobile"];

export const MOBILE_TOKENS: readonly string[] = [
  "iphone",
  "ipod",
  "iemobile",
  "windows phone",
  "blackberry",
  "bb10",
  "opera mini",
  "opera mobi",
];

export const DESKTOP_TOKENS: readonly string[] = [
  "windows nt",
  "macintosh",
  "x11",
  "cros",
  "chrome os",
  "freebsd",
  "openbsd",
  "netbsd",
];

export function classifyDeviceType(userAgent: string | null | undefined): DeviceType {
  const trimmed = userAgent?.trim() ?? "";

  // Gate order is load-bearing: an Android UA carries the Linux token, and an Android tablet is an
  // Android UA without the Mobile marker.
  if (isTablet(trimmed)) return "tablet";

  if (firesAny(trimmed, MOBILE_MARKER_TOKENS) || firesAny(trimmed, MOBILE_TOKENS)) return "mobile";

  if (firesAny(trimmed, DESKTOP_TOKENS)) return "desktop";

  return "unknown";
}

function isTablet(userAgent: string): boolean {
  if (firesAny(userAgent, TABLET_TOKENS)) return true;

  return firesAny(userAgent, ANDROID_TOKENS) && !firesAny(userAgent, MOBILE_MARKER_TOKENS);
}

function firesAny(userAgent: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => matchesToken(userAgent, token));
}
