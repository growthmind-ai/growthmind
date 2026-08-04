import { ROUTES } from "../routes";

export function seenPath(id: string): string {
  return `${ROUTES.seen}/${encodeURIComponent(id)}`;
}

export function fixPath(findingId: string): string {
  return `${ROUTES.fixes}/${encodeURIComponent(findingId)}`;
}

export function verdictPath(findingId: string): string {
  return `${ROUTES.verdicts}/${encodeURIComponent(findingId)}`;
}

export interface PreviewTab {
  readonly href: string;
  readonly label: string;
}

// Ordered the way a person meets the product, not the way the loop runs.
export const PREVIEW_TABS: readonly PreviewTab[] = [
  { href: ROUTES.seen, label: "What we've seen" },
  { href: ROUTES.channel, label: "In your channel" },
  { href: ROUTES.audience, label: "Who this is for" },
  { href: ROUTES.plan, label: "Before you build it" },
  { href: ROUTES.fixes, label: "The fix" },
  { href: ROUTES.agent, label: "What your agent sees" },
  { href: ROUTES.verdicts, label: "The verdict" },
  { href: ROUTES.collect, label: "What we collect" },
];
