import {
  EXCLUSION_RULE_SET_VERSION,
  URL_PATH_NORMALISATION_VERSION,
  type ExclusionReason,
  type SetAsideBreakdown,
} from "@growthmind/shared";

export const DATA_PAGE_TITLE = "What we do and do not collect";

export const DATA_PAGE_LEDE =
  "Every rule version below comes from the code that enforces it, and every count from your own " +
  "workspace. Change a rule without changing this page and a test fails.";

export const DATA_PAGE_CLOSING = "Nothing here is a setting. There is nothing to switch on.";

/** The unit every count on this page is in. Stated on each chip so two lines can never differ. */
export const COUNT_UNIT = "sessions";

// A receipt is what a statement can prove. `count` splits a number the reader can already see,
// `kept` is the denominator's other half, `transform` runs the rule itself in the browser.
// A statement with no producer carries none, and no control is drawn for it.
export type Receipt =
  | { readonly kind: "count"; readonly reasons: readonly ExclusionReason[] }
  | { readonly kind: "kept" }
  | { readonly kind: "transform" };

export interface Statement {
  readonly id: string;
  readonly text: string;
  readonly receipt?: Receipt;
}

export interface StatementGroup {
  readonly id: string;
  readonly label: string;
  readonly stamp?: string;
  readonly statements: readonly Statement[];
}

export const EXCLUSION_STAMP = `exclusion rules v${String(EXCLUSION_RULE_SET_VERSION)}`;

export const PAGE_ADDRESS_STAMP = `page address rules v${String(URL_PATH_NORMALISATION_VERSION)}`;

const AUTOMATION_REASONS: readonly ExclusionReason[] = [
  "automation_headless",
  "automation_known_agent",
  "automation_coding_agent",
];

export const DATA_GROUPS: readonly StatementGroup[] = [
  {
    id: "read",
    label: "What we read",
    statements: [
      {
        id: "read-events",
        text:
          "Events, and the people behind them, from the analytics you already run. " +
          "We never write to it.",
      },
      {
        id: "read-recordings",
        text: "Recordings of sessions where something looked wrong. Never all of them.",
      },
      {
        id: "read-code",
        text:
          "Not your code — reading a repository is not connected yet. When it is, it will be " +
          "read-only: we never write to your repository.",
      },
    ],
  },
  {
    id: "set-aside",
    label: "What we set aside",
    stamp: EXCLUSION_STAMP,
    statements: [
      {
        id: "aside-team",
        text:
          "Visits from your own team, worked out from the email address that created this " +
          "workspace.",
        receipt: { kind: "count", reasons: ["internal_domain"] },
      },
      {
        id: "aside-automation",
        text: "Bots, automated browsers and coding agents.",
        receipt: { kind: "count", reasons: AUTOMATION_REASONS },
      },
      {
        id: "aside-unsure",
        text:
          "When we are not sure whose visit is whose, we keep it. Setting aside a real customer " +
          "would hide the very thing you are here to see.",
        receipt: { kind: "kept" },
      },
    ],
  },
  {
    id: "recording",
    label: "What a recording keeps",
    stamp: PAGE_ADDRESS_STAMP,
    statements: [
      { id: "rec-pressed", text: "What was pressed, and what it was labelled." },
      {
        id: "rec-typing",
        text:
          "How many times a key was pressed — a count from your session recorder, not a record " +
          "of what was typed.",
      },
      {
        id: "rec-address",
        text:
          "The address of each page as a tidied-up pattern, never the raw address with your " +
          "customers' own details in it. Anything after a ? or a # is dropped entirely.",
        receipt: { kind: "transform" },
      },
      {
        id: "rec-identity",
        text:
          "Who someone is, stored as a scrambled stand-in that cannot be turned back into a " +
          "name or an address.",
      },
    ],
  },
  {
    id: "leaves",
    label: "What leaves this system",
    statements: [
      {
        id: "leaves-scan",
        text:
          "Everything we send to your channel is checked for leftover personal details before " +
          "it leaves.",
      },
      {
        id: "leaves-tenancy",
        text:
          "Nothing crosses from your workspace to another customer's. Every record is stored " +
          "against your workspace and read back only for it.",
      },
      {
        id: "leaves-confidence",
        text: "When the evidence sits below the level we ask for, the finding is not sent at all.",
      },
    ],
  },
];

/** The org-wide read, flattened to what this page renders. `null` when the count could not be read. */
export interface CountsView {
  readonly total: number;
  readonly kept: number;
  readonly setAside: readonly SetAsideBreakdown[];
  readonly ruleSetVersions: readonly number[];
}

export interface CountRow {
  readonly label: string;
  readonly count: number;
}

export interface CountReceiptView {
  readonly rows: readonly CountRow[];
  readonly subtotal: number;
  readonly total: number;
  readonly totalLabel: string;
}

function rowsFor(counts: CountsView, reasons: readonly ExclusionReason[]): readonly CountRow[] {
  return counts.setAside
    .filter((entry) => reasons.includes(entry.reason))
    .map((entry) => ({ label: entry.label, count: entry.count }));
}

export function countReceipt(counts: CountsView, receipt: Receipt): CountReceiptView | null {
  if (receipt.kind === "transform") return null;

  if (receipt.kind === "kept") {
    return {
      rows: [{ label: "Kept and counted", count: counts.kept }],
      subtotal: counts.kept,
      total: counts.total,
      totalLabel: "Kept and counted",
    };
  }

  const rows = rowsFor(counts, receipt.reasons);

  return {
    rows,
    subtotal: rows.reduce((sum, row) => sum + row.count, 0),
    total: counts.total,
    totalLabel: "Set aside by this rule",
  };
}

/**
 * Reasons the page's own statements do not claim. Rendered rather than dropped, so the group
 * still adds up to the denominator when a rule this page has never described starts stamping rows.
 */
export function unclaimedSetAside(counts: CountsView): readonly CountRow[] {
  const claimed = new Set(
    DATA_GROUPS.flatMap((group) => group.statements).flatMap((statement) =>
      statement.receipt?.kind === "count" ? statement.receipt.reasons : [],
    ),
  );

  return counts.setAside
    .filter((entry) => !claimed.has(entry.reason))
    .map((entry) => ({ label: entry.label, count: entry.count }));
}

export function chipLabel(counts: CountsView | null, receipt: Receipt): string {
  if (receipt.kind === "transform") return "Show me";
  if (counts === null) return "Show me";
  if (counts.total === 0) return "Nothing seen yet";

  const view = countReceipt(counts, receipt);
  const subtotal = view === null ? 0 : view.subtotal;

  return `${String(subtotal)} of ${String(counts.total)} ${COUNT_UNIT}`;
}

/**
 * A count spanning more than one rule set cannot be described by one "under these rules"
 * sentence, and a stamped session is never re-judged — so the split is stated as provenance
 * rather than hidden behind the current version.
 */
export function mixedVersionNote(counts: CountsView): string | null {
  if (counts.ruleSetVersions.length < 2) return null;

  const listed = counts.ruleSetVersions.map((version) => `v${String(version)}`);
  const spelled = `${listed.slice(0, -1).join(", ")} and ${listed[listed.length - 1] ?? ""}`;

  return (
    `These ${COUNT_UNIT} were not all judged by the same rules: they carry exclusion rules ` +
    `${spelled}. We never re-judge a session after it has been stamped, so each one reflects ` +
    `the rules in force when it arrived.`
  );
}

export const NO_COUNTS_NOTE =
  "We cannot reach your workspace's numbers right now. The rule still holds.";

// "0 of 0 sessions" is technically compliant and useless, so the denominator rule is met in
// words — and the state names what produces the first row rather than reporting a vacuum.
export const NOTHING_SEEN_NOTE =
  "We have not seen a session in this workspace yet, so there is nothing to count. Sessions " +
  "start arriving once your analytics is attached.";

export const NOTHING_SEEN_RECEIPT =
  "Nothing has been seen in this workspace yet. When it has, this rule will show how many " +
  "sessions it set aside, out of how many we saw.";

export const NOTHING_SEEN_ACTION = "Attach your analytics in settings";

/** What settings can actually do about the alarm below: show the address, not change it. */
export const EVERYTHING_SET_ASIDE_ACTION = "See which address we treat as your team";

// The loudest sentence on the page pointed at a settings section that only restates it —
// there is no route that edits the inferred domain. So the note names both resolutions and
// says the second one is not yours to make yet, rather than implying a control exists.
export function everythingSetAsideNote(counts: CountsView): string | null {
  if (counts.total === 0 || counts.kept > 0) return null;

  const dominant = counts.setAside[0];
  const named =
    dominant === undefined
      ? "one of the rules below"
      : `${dominant.label.toLowerCase()} (${String(dominant.count)} of ${String(counts.total)})`;

  return (
    `Every one of the ${String(counts.total)} ${COUNT_UNIT} we have seen was set aside, so ` +
    `nothing is feeding your findings. The rule catching the most is ${named}. Either that is ` +
    `right and nobody outside your team has been through yet, or the address we work your team ` +
    `out from is the wrong one — settings shows which address that is. Changing it is not ` +
    `something you can do yourself yet, so if it is wrong, tell us.`
  );
}

/**
 * The whole document, every group and every statement, whichever receipts the sender happened
 * to open. What was clicked must never decide what the recipient receives.
 */
export function dataPageText(counts: CountsView | null): string {
  const lines: string[] = [DATA_PAGE_TITLE, "", DATA_PAGE_LEDE, ""];

  for (const group of DATA_GROUPS) {
    lines.push(group.stamp === undefined ? group.label : `${group.label}  (${group.stamp})`);

    for (const statement of group.statements) {
      const receipt = statement.receipt;
      const suffix =
        receipt === undefined || counts === null || receipt.kind === "transform"
          ? ""
          : `  [${chipLabel(counts, receipt)}]`;
      lines.push(`- ${statement.text}${suffix}`);
    }

    lines.push("");
  }

  if (counts === null) {
    lines.push(NO_COUNTS_NOTE, "");
  } else if (counts.total === 0) {
    lines.push(NOTHING_SEEN_NOTE, "");
  } else {
    const note = mixedVersionNote(counts);
    if (note !== null) lines.push(note, "");
  }

  lines.push(DATA_PAGE_CLOSING);

  return lines.join("\n");
}
