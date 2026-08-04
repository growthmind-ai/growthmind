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

// Slack first: that is where the work arrives (product decisions §10). The rest is the
// record it leaves behind, in the order it accumulates.
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

// Settings and the profile are not here: they hang off the account block at the foot of the
// rail, which is where a signed-in person looks for their own things. Listing them twice makes
// the nav answer "where do I work" and "who am I" in one column, and neither answer reads.
//
// The nav is built from what the viewer can actually open. Someone off the preview allow list
// gets `notFound` on every Work and Your-product route, so offering them the links would be a
// sidebar of nine dead ends — they get Home, and the account menu that has always been there.
export function navGroupsFor(canSeePreview: boolean): readonly NavGroup[] {
  return canSeePreview ? [ROOT, WORK, PRODUCT] : [ROOT];
}
