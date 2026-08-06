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

const FINDINGS: NavItem = { href: ROUTES.findings, label: "Findings" };

const RECORDINGS: NavItem = { href: ROUTES.replays, label: "Recordings" };

// Same connection as Recordings, one level up: sessions grouped by account.
const COMPANIES: NavItem = { href: ROUTES.companies, label: "Companies" };

// Slack first: that is where the work arrives, pushed rather than pulled.
const WORK: NavGroup = {
  label: "Work",
  items: [
    { href: ROUTES.channel, label: "In Slack" },
    FINDINGS,
    { href: ROUTES.fixes, label: "Fixes" },
    { href: ROUTES.experiments, label: "Experiments" },
    RECORDINGS,
    COMPANIES,
  ],
};

// Findings, Recordings and Companies read real rows under the org's own tenant context, so
// they answer for everyone rather than only the preview list — the same reason the agent
// page does. Channel, Fixes and Experiments stay preview-only until their own record is live.
const WORK_LIVE: NavGroup = { label: "Work", items: [FINDINGS, RECORDINGS, COMPANIES] };

const AGENT: NavItem = { href: ROUTES.agent, label: "Your agent" };

const PRODUCT: NavGroup = {
  label: "Your product",
  items: [
    { href: ROUTES.audience, label: "Audience" },
    { href: ROUTES.plan, label: "Before you build" },
    AGENT,
    { href: ROUTES.data, label: "Your data" },
  ],
};

// The agent page is the only one of the four running on real rows, and it is the only way
// to a key after setup — which nothing links back to. It cannot sit behind the preview list.
const PRODUCT_LIVE: NavGroup = { label: "Your product", items: [AGENT] };

// Settings and the profile hang off the account block at the foot of the rail, not here.
// Off the preview allow list every Work route is a `notFound`, and of Your product only
// the agent page answers.
export function navGroupsFor(canSeePreview: boolean): readonly NavGroup[] {
  return canSeePreview ? [ROOT, WORK, PRODUCT] : [ROOT, WORK_LIVE, PRODUCT_LIVE];
}
