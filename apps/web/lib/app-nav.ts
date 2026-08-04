import { ROUTES } from "./routes";

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export interface NavGroup {
  // Null for the one group that needs no heading — a single entry above the rule reads as
  // the root, and "Home / Home" reads as a mistake.
  readonly label: string | null;
  readonly items: readonly NavItem[];
}

const ROOT: NavGroup = {
  label: null,
  items: [{ href: ROUTES.home, label: "Home" }],
};

// Slack sits first because that is where the work actually arrives (product decisions §10).
// The rest of this group is the record it leaves behind, in the order it accumulates.
const WORK: NavGroup = {
  label: "Work",
  items: [
    { href: ROUTES.channel, label: "In Slack" },
    { href: ROUTES.findings, label: "Findings" },
    { href: ROUTES.fixes, label: "Fixes" },
    { href: ROUTES.experiments, label: "Experiments" },
  ],
};

const PRODUCT: NavGroup = {
  label: "Your product",
  items: [
    { href: ROUTES.audience, label: "Audience" },
    { href: ROUTES.plan, label: "Before you build" },
    { href: ROUTES.agent, label: "Your agent" },
    { href: ROUTES.data, label: "Your data" },
  ],
};

const ACCOUNT: NavGroup = {
  label: "Account",
  items: [
    { href: ROUTES.settings, label: "Settings" },
    { href: ROUTES.account, label: "Profile" },
  ],
};

// The nav is built from what the viewer can actually open. Someone off the preview allow list
// gets `notFound` on every Work and Your-product route, so offering them the links would be a
// sidebar of nine dead ends.
export function navGroupsFor(canSeePreview: boolean): readonly NavGroup[] {
  return canSeePreview ? [ROOT, WORK, PRODUCT, ACCOUNT] : [ROOT, ACCOUNT];
}
