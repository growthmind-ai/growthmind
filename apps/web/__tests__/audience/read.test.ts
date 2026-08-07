// Wave 0 red for ADD O-036 AD-5 (apps/web/lib/audience/read.ts — the pure view-model
// buildAudienceView does not exist yet). Loaded by path so repo-wide typecheck stays green;
// every test fails through loadBuildAudienceView until Wave 4 builds the module.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  renderAudienceRule,
  type BusinessFact,
  type BusinessFactKind,
  type FactProvenance,
} from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { ROUTES } from "@/lib/routes";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_PATH = path.join(WEB_ROOT, "lib", "audience", "read.ts");

const VIEWER = "viewer-user-91f2c4d8";
const TEAMMATE = "teammate-user-5a7b3e10";
const HOSTNAME = "acme-example.com";
const READ_AT = new Date("2026-08-01T09:00:00.000Z");

type BuildAudienceView = (research: unknown, viewer: { readonly userId: string }) => unknown;

async function loadBuildAudienceView(): Promise<BuildAudienceView> {
  if (!existsSync(SOURCE_PATH)) {
    throw new Error(
      "apps/web/lib/audience/read.ts does not exist yet, so nothing turns a BusinessResearchRow " +
        "into an AudienceView (ADD O-036 AD-5). This is a Wave 0 red for the RIGHT reason.",
    );
  }

  const loaded = (await import(pathToFileURL(SOURCE_PATH).href)) as Record<string, unknown>;
  const candidate = loaded["buildAudienceView"];
  if (typeof candidate !== "function") {
    throw new Error("apps/web/lib/audience/read.ts exports no buildAudienceView yet.");
  }

  return candidate as BuildAudienceView;
}

interface ResearchRowFixture {
  readonly siteDomain: string | null;
  readonly businessContext: {
    readonly facts: readonly unknown[];
    readonly removed: readonly string[];
  };
  readonly researchStatus: "never_run" | "running" | "done" | "failed";
  readonly researchedAt: Date | null;
  readonly researchFailure: string | null;
  readonly updatedAt: Date;
}

function researchRow(over: Partial<ResearchRowFixture> = {}): ResearchRowFixture {
  return {
    siteDomain: HOSTNAME,
    businessContext: { facts: [], removed: [] },
    researchStatus: "done",
    researchedAt: READ_AT,
    researchFailure: null,
    updatedAt: READ_AT,
    ...over,
  };
}

function siteProvenance(citation: string | null): FactProvenance {
  return { source: "site", at: READ_AT, citation, seen: null };
}

function sessionsProvenance(sessions: number, of: number): FactProvenance {
  return {
    source: "sessions",
    at: READ_AT,
    citation: null,
    seen: { sessions, of, from: new Date("2026-07-01T00:00:00.000Z"), to: READ_AT },
  };
}

function statedProvenance(): FactProvenance {
  return { source: "stated_by_customer", at: READ_AT, citation: null, seen: null };
}

function fact(
  over: { kind: BusinessFactKind; statement: string } & Partial<BusinessFact>,
): BusinessFact {
  return {
    provenance: siteProvenance(`https://${HOSTNAME}/pricing`),
    correctedFrom: null,
    audience: null,
    ...over,
  };
}

async function builtView(research: ResearchRowFixture | null, userId = VIEWER): Promise<unknown> {
  const build = await loadBuildAudienceView();
  return build(research, { userId });
}

function kindOf(view: unknown): unknown {
  return (view as { kind?: unknown }).kind;
}

function stringsIn(value: unknown, acc: string[] = []): string[] {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) stringsIn(item, acc);
  } else if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    for (const item of Object.values(value)) stringsIn(item, acc);
  }
  return acc;
}

function textOf(view: unknown): string {
  return stringsIn(view).join("\n");
}

function objectsIn(value: unknown, acc: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    for (const item of value) objectsIn(item, acc);
  } else if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    acc.push(value as Record<string, unknown>);
    for (const item of Object.values(value)) objectsIn(item, acc);
  }
  return acc;
}

describe("the empty page is honest before it is helpful (FR-11)", () => {
  test("should render no-website when no row exists or research never ran", async () => {
    const fromNoRow = await builtView(null);
    const fromNeverRun = await builtView(
      researchRow({ siteDomain: null, researchStatus: "never_run", researchedAt: null }),
    );

    expect(kindOf(fromNoRow)).toBe("no-website");
    expect(kindOf(fromNeverRun)).toBe("no-website");

    for (const view of [fromNoRow, fromNeverRun]) {
      const text = textOf(view);
      expect(text).not.toContain("who_counts");
      expect(text).not.toMatch(/\d+ of \d+ sessions/);
      expect(text).not.toContain("Seen in");
    }
  });

  test("empty state names one next action and links the real settings control", async () => {
    const view = await builtView(null);
    const text = textOf(view);

    expect(stringsIn(view)).toContain(ROUTES.settings);
    expect(text).toContain("No model yet");
    expect(text).toContain("Name your website in Settings");
  });
});

describe("the two waiting states say what is happening, in plain words (UX §5, FR-13)", () => {
  test("should render reading while research runs with no facts", async () => {
    const view = await builtView(researchRow({ researchStatus: "running", researchedAt: null }));

    expect(kindOf(view)).toBe("reading");
    expect(textOf(view)).toContain(HOSTNAME);
  });

  test("should render read-failed-research on failure with no vendor error text", async () => {
    const vendorError =
      "FetchError: connect ECONNREFUSED 104.18.32.7:443 (upstream trace 9f81-bc2)";
    const view = await builtView(
      researchRow({ researchStatus: "failed", researchFailure: vendorError }),
    );
    const text = textOf(view);

    expect(kindOf(view)).toBe("read-failed-research");
    expect(text).toContain(HOSTNAME);
    expect(text).not.toContain(vendorError);
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("FetchError");
    expect(text).not.toContain("trace");
  });
});

describe("a thin model says so with real numbers (UX §5 thin)", () => {
  test("should render populated with a thin note under 5 facts or 3 kinds", async () => {
    const thin = await builtView(
      researchRow({
        businessContext: {
          facts: [
            fact({ kind: "regime", statement: "They sell into regulated healthcare" }),
            fact({ kind: "regime", statement: "Procurement approves every purchase" }),
            fact({ kind: "forbidden_move", statement: "Never auto-email their patients" }),
          ],
          removed: [],
        },
      }),
    );

    expect(kindOf(thin)).toBe("populated");
    expect(Boolean((thin as { thin?: unknown }).thin)).toBe(true);
    expect(textOf(thin)).toContain("of 12 kinds");
    expect(textOf(thin)).toContain("3");

    const rich = await builtView(
      researchRow({
        businessContext: {
          facts: [
            fact({ kind: "regime", statement: "They sell into regulated healthcare" }),
            fact({ kind: "regime", statement: "Procurement approves every purchase" }),
            fact({ kind: "forbidden_move", statement: "Never auto-email their patients" }),
            fact({ kind: "conversion", statement: "A booked demo counts as a win" }),
            fact({ kind: "decision_cadence", statement: "They renew once a year" }),
            fact({ kind: "arrives_expecting", statement: "They arrive expecting a price list" }),
          ],
          removed: [],
        },
      }),
    );

    expect(kindOf(rich)).toBe("populated");
    expect(Boolean((rich as { thin?: unknown }).thin)).toBe(false);
    expect(textOf(rich)).not.toContain("of 12 kinds");
  });
});

describe("provenance never overclaims (FR-3)", () => {
  test("should render a null-citation site fact as assumed, never as a person's statement", async () => {
    const view = await builtView(
      researchRow({
        businessContext: {
          facts: [
            fact({
              kind: "regime",
              statement: "They answer to a financial regulator",
              provenance: siteProvenance(null),
            }),
          ],
          removed: [],
        },
      }),
    );
    const text = textOf(view).toLowerCase();

    expect(text).toContain("assumed");
    expect(text).not.toContain("you told us");
    expect(text).not.toContain("you said");
  });

  test("should render every seen count as N of M sessions and never bare", async () => {
    const view = await builtView(
      researchRow({
        businessContext: {
          facts: [
            fact({
              kind: "who_counts",
              statement: "Buyers arrive from procurement portals",
              provenance: sessionsProvenance(3, 47),
            }),
            fact({
              kind: "decision_cadence",
              statement: "They compare vendors over two weeks",
              provenance: sessionsProvenance(12, 47),
            }),
          ],
          removed: [],
        },
      }),
    );

    expect(textOf(view)).toContain("3 of 47 sessions");

    const bare = stringsIn(view).filter((value) => /(?<!of )\b\d+ sessions\b/.test(value));
    expect(bare).toEqual([]);
  });
});

describe("doubts derive from what actually gates the numbers (UX §4.5)", () => {
  test("should derive doubts from unconfirmed proposals then empty stated-only binding kinds, capped at 4", async () => {
    const rule = {
      clauses: [
        { attribute: "entry_path" as const, operator: "starts_with" as const, value: "/pricing" },
      ],
    };
    const view = await builtView(
      researchRow({
        businessContext: {
          facts: [
            fact({
              kind: "who_counts",
              statement: "Buyers arrive on the pricing page",
              audience: { rule, status: "proposed", decidedAt: null },
            }),
            fact({ kind: "regime", statement: "They sell into regulated healthcare" }),
          ],
          removed: [],
        },
      }),
    );

    const doubts = (view as { doubts?: unknown }).doubts;
    expect(Array.isArray(doubts)).toBe(true);

    const rows = doubts as readonly unknown[];
    // 1 unconfirmed proposal + 4 empty stated-only binding kinds = 5 candidates, capped at 4.
    expect(rows.length).toBe(4);

    const renderedRule = renderAudienceRule(rule);
    expect(textOf(rows[0])).toContain(renderedRule);
    expect(textOf(rows.slice(1))).not.toContain(renderedRule);

    const allDoubtText = textOf(rows).toLowerCase();
    expect(allDoubtText).not.toContain("staleness");
    expect(allDoubtText).not.toContain("how fresh");
  });
});

describe("what a person deleted stays deleted on screen (UX §4.1)", () => {
  test("should never surface removed statements in any view", async () => {
    const removedMarker = "the sentence a person deleted never-render-0042";
    const removed = [removedMarker];

    const populated = await builtView(
      researchRow({
        businessContext: {
          facts: [fact({ kind: "regime", statement: "They sell into regulated healthcare" })],
          removed,
        },
      }),
    );
    const reading = await builtView(
      researchRow({
        researchStatus: "running",
        researchedAt: null,
        businessContext: { facts: [], removed },
      }),
    );
    const failed = await builtView(
      researchRow({
        researchStatus: "failed",
        researchFailure: "unreachable",
        businessContext: { facts: [], removed },
      }),
    );

    for (const view of [populated, reading, failed]) {
      expect(textOf(view)).not.toContain(removedMarker);
    }
  });
});

describe("a correction keeps its history and its rank (FR-8, FR-9, FR-10)", () => {
  const OLD_CLAIM = "Their buyers churn within a week";
  const NEW_CLAIM = "Their buyers renew annually on procurement cycles";
  const SITE_CLAIM = "Their site says buyers self-serve";

  function correctedContext(): ResearchRowFixture {
    return researchRow({
      businessContext: {
        facts: [
          fact({
            kind: "regime",
            statement: NEW_CLAIM,
            correctedFrom: OLD_CLAIM,
            provenance: statedProvenance(),
          }),
          fact({ kind: "regime", statement: SITE_CLAIM }),
        ],
        removed: [],
      },
    });
  }

  test("should carry struck-through prior text for a corrected fact", async () => {
    const view = await builtView(correctedContext());

    const holder = objectsIn(view).find((entry) => {
      const values = Object.values(entry).filter(
        (value): value is string => typeof value === "string",
      );
      return (
        values.some((value) => value.includes(NEW_CLAIM)) &&
        values.some((value) => value.includes(OLD_CLAIM) && !value.includes(NEW_CLAIM))
      );
    });

    expect(holder).toBeDefined();
  });

  test("should lead each kind with corrected and stated facts after a correction", async () => {
    const text = textOf(await builtView(correctedContext()));

    expect(text.indexOf(NEW_CLAIM)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(SITE_CLAIM)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(NEW_CLAIM)).toBeLessThan(text.indexOf(SITE_CLAIM));
  });
});

describe("attribution is honest and never leaks an id (AD-4, FR-13)", () => {
  test("should attribute chips as by-you only when the actor id matches the viewer", async () => {
    const view = await builtView(
      researchRow({
        businessContext: {
          facts: [
            {
              ...fact({ kind: "conversion", statement: "A booked demo counts as a win" }),
              confirmation: { at: READ_AT, by: VIEWER },
            },
            {
              ...fact({ kind: "forbidden_move", statement: "Never auto-email their patients" }),
              confirmation: { at: READ_AT, by: TEAMMATE },
            },
            {
              ...fact({
                kind: "regime",
                statement: "They renew annually on procurement cycles",
                correctedFrom: "They churn within a week",
              }),
              provenance: { ...statedProvenance(), statedBy: VIEWER },
            },
            {
              ...fact({
                kind: "invalidating_period",
                statement: "The numbers lie during the January sale",
                correctedFrom: "The numbers hold year-round",
              }),
              provenance: { ...statedProvenance(), statedBy: null },
            },
          ],
          removed: [],
        },
      }),
      VIEWER,
    );
    const text = textOf(view);

    expect(text).toMatch(/confirmed by you\b/);
    expect(text).toContain("confirmed by your team");
    expect(text).toMatch(/corrected by you\b/);
    expect(text).toContain("corrected by your team");

    expect(text).not.toContain(VIEWER);
    expect(text).not.toContain(TEAMMATE);
  });
});
