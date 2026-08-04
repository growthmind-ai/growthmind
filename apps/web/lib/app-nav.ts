import { ROUTES } from "./routes";

export interface NavItem {
  readonly href: string;
  readonly label: string;
}

export interface NavGroup {
  // Null for the group that needs no heading: "Home / Home" reads as a mistake.
  readonly label: string | null;
  readonly items: readonly NavItem[];
}

const ROOT: NavGroup = {
  label: null,
  items: [{ href: ROUTES.home, label: "Home" }],
};

// Slack first: that is where the work arrives (product decisions §10).
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

// Settings and the profile hang off the account block at the foot of the rail, not here.
// Off the preview allow list every Work and Your-product route is a `notFound`.
export function navGroupsFor(canSeePreview: boolean): readonly NavGroup[] {
  return canSeePreview ? [ROOT, WORK, PRODUCT] : [ROOT];
}
