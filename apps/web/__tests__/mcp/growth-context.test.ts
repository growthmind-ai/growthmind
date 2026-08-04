import {
  FIX_SURFACE_FORBIDDEN_REFUSALS,
  MCP_TOOL,
  SURFACE_ROLE_NOTES,
  getGrowthContextOutputSchema,
} from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { callTool } from "../../lib/mcp/call-tool";
import { toGrowthContextRecord } from "../../lib/mcp/dto";
import type { GrowthContextAnswer } from "../../lib/mcp/read-port";
import { credentialFor, fakeReadPort, openFixRowFor } from "./helpers/mcp-fixture";

const ORG = "org-growth-context";
const PROJECT = "project-growth-context";

const WINDOW_START = new Date("2026-07-24T00:00:00.000Z");
const WINDOW_END = new Date("2026-07-31T00:00:00.000Z");

function persistedCount(numerator: number, denominator: number) {
  return {
    numerator,
    denominator,
    unit: "sessions" as const,
    timeframe: { start: WINDOW_START, end: WINDOW_END },
    basis: { totalInWindow: denominator, kept: denominator, setAside: [] },
  };
}

function answerFor(overrides: {
  surface?: string | null;
  changeable?: { allowed: boolean; reason: "pricing_or_billing" | null } | null;
  whatMatters?: readonly { surface: string; role: "makes_money"; confirmedByAPerson: boolean }[];
  knownProblems?: readonly {
    findingId: string;
    fixId: string | null;
    headline: string;
    affected: ReturnType<typeof persistedCount>;
    lastSeenAt: Date;
  }[];
  declined?: readonly { headline: string; declinedAt: Date }[];
}): GrowthContextAnswer {
  return {
    outcome: "answered",
    record: toGrowthContextRecord({
      projectId: PROJECT,
      surface: overrides.surface ?? null,
      changeable: overrides.changeable ?? null,
      whatMatters: overrides.whatMatters ?? [],
      knownProblems: overrides.knownProblems ?? [],
      declined: overrides.declined ?? [],
    }),
  };
}

async function ask(answer: GrowthContextAnswer, input: Record<string, unknown> = {}) {
  const port = fakeReadPort({ growthContexts: [{ organizationId: ORG, answer }] }).port;

  return callTool(MCP_TOOL.GET_GROWTH_CONTEXT, input, port, credentialFor(ORG));
}

describe("get_growth_context", () => {
  test("answers what a page is for, in a sentence a person could read", async () => {
    const outcome = await ask(
      answerFor({
        surface: "/checkout",
        changeable: { allowed: true, reason: null },
        whatMatters: [{ surface: "/checkout", role: "makes_money", confirmedByAPerson: true }],
      }),
      { surface: "/checkout" },
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error("expected an answer");

    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.whatMatters[0]?.matters).toBe(SURFACE_ROLE_NOTES.makes_money);
    expect(parsed.whatMatters[0]?.confirmedByAPerson).toBe(true);
    expect(parsed.nothingKnownYet).toBe(false);
  });

  test("says a page is out of bounds, and says why, before any work starts", async () => {
    // The §5 answer an agent needs at brief time rather than after it has written the change.
    const outcome = await ask(
      answerFor({
        surface: "/checkout",
        changeable: { allowed: false, reason: "pricing_or_billing" },
      }),
      { surface: "/checkout" },
    );

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.changeable?.allowed).toBe(false);
    expect(parsed.changeable?.reason).toBe(FIX_SURFACE_FORBIDDEN_REFUSALS.pricing_or_billing);
  });

  test("carries the ideas a person already turned down, so they are not raised again", async () => {
    const outcome = await ask(
      answerFor({
        surface: "/onboarding",
        changeable: { allowed: true, reason: null },
        declined: [
          { headline: "Ask for a company name on the first screen", declinedAt: WINDOW_END },
        ],
      }),
      { surface: "/onboarding" },
    );

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.declined).toHaveLength(1);
    expect(parsed.declined[0]?.headline).toBe("Ask for a company name on the first screen");
    expect(parsed.declined[0]?.declinedAt).toBe(WINDOW_END.toISOString());
  });

  test("answers without a page named, and withholds a verdict it was not asked for", async () => {
    const outcome = await ask(
      answerFor({
        surface: null,
        whatMatters: [{ surface: "/checkout", role: "makes_money", confirmedByAPerson: false }],
      }),
      {},
    );

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.surface).toBeNull();
    expect(parsed.changeable).toBeNull();
    expect(parsed.whatMatters).toHaveLength(1);
  });

  test("says plainly that nothing is known yet, which is not a refusal", async () => {
    const outcome = await ask(answerFor({ surface: null }), {});

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.nothingKnownYet).toBe(true);
    expect(parsed.whatMatters).toEqual([]);
    expect(parsed.knownProblems).toEqual([]);
  });

  test("names the ids to choose between when a person runs more than one product", async () => {
    // Errors instruct: the refusal is only useful if it carries the caller's next call.
    const outcome = await ask({
      outcome: "ambiguous_project",
      projectIds: ["project-one", "project-two"],
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("expected a refusal");

    expect(outcome.refusal.code).toBe("ambiguous_project");
    expect(outcome.refusal.message).toContain("project-one");
    expect(outcome.refusal.message).toContain("project-two");
    expect(outcome.refusal.message).toContain("projectId");
  });

  test("tells an agent to carry on when there is nothing set up at all", async () => {
    const outcome = await ask({ outcome: "no_project" });

    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.refusal.status).toBe(404);
    expect(outcome.refusal.message).toContain("not a reason to stop");
  });

  test("refuses input it cannot read rather than guessing at it", async () => {
    const outcome = await ask(answerFor({ surface: null }), { surface: 42 });

    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.refusal.code).toBe("malformed_request");
  });

  test("reads a problem's count through the same wire shape every other tool uses", async () => {
    const outcome = await ask(
      answerFor({
        surface: "/onboarding",
        changeable: { allowed: true, reason: null },
        knownProblems: [
          {
            findingId: "finding-1",
            fixId: "fix-1",
            headline: "People stop at the second step",
            affected: persistedCount(19, 28),
            lastSeenAt: WINDOW_END,
          },
        ],
      }),
      { surface: "/onboarding" },
    );

    if (!outcome.ok) throw new Error("expected an answer");
    const parsed = getGrowthContextOutputSchema.parse(outcome.result);

    expect(parsed.knownProblems[0]?.affected.numerator).toBe(19);
    expect(parsed.knownProblems[0]?.affected.denominator).toBe(28);
    expect(parsed.knownProblems[0]?.fixId).toBe("fix-1");
  });
});

describe("list_open_fixes keeps the order it was given", () => {
  test("does not re-sort the ranked list back into deadline order", async () => {
    // The read port ranks by expected value, which is what §6 means by urgency and what this
    // tool's description promises. A sort here on the readout date silently undid it.
    const soonest = openFixRowFor({
      fixId: "fix-later-deadline",
      findingId: "finding-worth-more",
      resultsBy: "2026-09-01T00:00:00.000Z",
    });
    const latest = openFixRowFor({
      fixId: "fix-sooner-deadline",
      findingId: "finding-worth-less",
      resultsBy: "2026-08-10T00:00:00.000Z",
    });

    const port = {
      listOpenFixes: () => Promise.resolve({ fixes: [soonest, latest], totalOpen: 2 }),
      getFix: () => Promise.resolve(null),
      getFinding: () => Promise.resolve(null),
      getGrowthContext: () => Promise.resolve({ outcome: "no_project" as const }),
    };

    const outcome = await callTool(MCP_TOOL.LIST_OPEN_FIXES, {}, port, credentialFor(ORG));

    if (!outcome.ok) throw new Error("expected an answer");
    const result = outcome.result as { fixes: readonly { fixId: string }[] };

    expect(result.fixes.map((fix) => fix.fixId)).toEqual([
      "fix-later-deadline",
      "fix-sooner-deadline",
    ]);
  });
});
