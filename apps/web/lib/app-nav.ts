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
const CHANNEL: NavItem = { href: ROUTES.channel, label: "In Slack" };

const FIXES: NavItem = { href: ROUTES.fixes, label: "Fixes" };

const WORK: NavGroup = {
  label: "Work",
  items: [
    CHANNEL,
    FINDINGS,
    FIXES,
    { href: ROUTES.experiments, label: "Experiments" },
    RECORDINGS,
    COMPANIES,
  ],
};

// Everything here reads real rows under the org's own tenant context, so it answers for
// everyone rather than only the preview list. Experiments is the one Work route still on
// fixtures: verdicts do not exist as data at all until O-028 and O-034.
const WORK_LIVE: NavGroup = {
  label: "Work",
  items: [CHANNEL, FINDINGS, FIXES, RECORDINGS, COMPANIES],
};

const AGENT: NavItem = { href: ROUTES.agent, label: "Your agent" };

const DATA: NavItem = { href: ROUTES.data, label: "Your data" };

const AUDIENCE: NavItem = { href: ROUTES.audience, label: "Audience" };

const PRODUCT: NavGroup = {
  label: "Your product",
  items: [AUDIENCE, { href: ROUTES.plan, label: "Before you build" }, AGENT, DATA],
};

// Audience reads the live business-context model, so it answers for everyone. Before-you-build
// waits on O-033's brief-time exchange, so it stays behind the list. The agent page is also
// the only way to a key once setup is behind you, which nothing links back to — it could
// never have sat there.
const PRODUCT_LIVE: NavGroup = { label: "Your product", items: [AUDIENCE, AGENT, DATA] };

// Settings and the profile hang off the account block at the foot of the rail, not here.
// Off the preview allow list every Work route is a `notFound`, and of Your product only
// the agent page answers.
export function navGroupsFor(canSeePreview: boolean): readonly NavGroup[] {
  return canSeePreview ? [ROOT, WORK, PRODUCT] : [ROOT, WORK_LIVE, PRODUCT_LIVE];
}
