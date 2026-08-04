import { ROUTES } from "../routes";

export function evidencePath(id: string): string {
  return `${ROUTES.evidence}/${encodeURIComponent(id)}`;
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

export interface PreviewTabGroup {
  readonly label: string;
  readonly numbered: boolean;
  readonly tabs: readonly PreviewTab[];
}

// Two kinds of surface, shown as two kinds: the loop is a story with an order, so its
// tabs are numbered steps; the rest is standing reference, so its tabs are not.
export const PREVIEW_TAB_GROUPS: readonly PreviewTabGroup[] = [
  {
    label: "One finding, start to finish",
    numbered: true,
    tabs: [
      { href: ROUTES.channel, label: "In your channel" },
      { href: ROUTES.evidence, label: "The evidence" },
      { href: ROUTES.fixes, label: "The fix" },
      { href: ROUTES.verdicts, label: "The verdict" },
    ],
  },
  {
    label: "The account we keep",
    numbered: false,
    tabs: [
      { href: ROUTES.seen, label: "What we've seen" },
      { href: ROUTES.audience, label: "Who this is for" },
      { href: ROUTES.plan, label: "Before you build it" },
      { href: ROUTES.agent, label: "What your agent sees" },
      { href: ROUTES.collect, label: "What we collect" },
    ],
  },
];
