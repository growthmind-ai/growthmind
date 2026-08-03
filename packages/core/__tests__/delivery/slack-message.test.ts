import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { EXCLUSION_REASON_LABELS, FORBIDDEN_PRODUCT_JARGON } from "@growthmind/shared";
import { FINDING_BLOCK_ID_PREFIX, GET_IT_FIXED_ACTION_ID } from "@growthmind/shared";
import { SUMMARY_SOURCE_MESSAGES, nothingTodayReasonSchema } from "@growthmind/shared";
import type { ExclusionReason, NothingTodayReason } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { measuredCount } from "../../src/counts/measured-count";
import type { CountBasis, MeasuredCount, SetAsideBasis } from "../../src/counts/measured-count";
import {
  COHORT_NOUNS,
  MAX_OBSERVATIONS,
  SLACK_MESSAGE_CHARACTER_BUDGET,
  SLACK_MESSAGE_LINE_BUDGET,
  SURFACE_PATH_BUDGET,
  describesPeople,
  renderCountSentence,
  renderSlackMessage,
  slackMessageInputSchema,
} from "../../src/delivery/slack-message";
import type {
  DeliveryVocabulary,
  Observation,
  SlackActionsBlock,
  SlackBlock,
  SlackMessageInput,
} from "../../src/delivery/slack-message";

const FIXTURE_WINDOW = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
} as const;

function setAside(reason: ExclusionReason, count: number): SetAsideBasis {
  return { reason, count, label: EXCLUSION_REASON_LABELS[reason] };
}

const KEPT_BASIS: CountBasis = {
  totalInWindow: 40,
  kept: 28,
  setAside: [setAside("automation_known_agent", 9), setAside("internal_domain", 3)],
};

const ALL_SET_ASIDE_BASIS: CountBasis = {
  totalInWindow: 40,
  kept: 0,
  setAside: [setAside("automation_headless", 31), setAside("internal_domain", 9)],
};

function countOf(numerator: number, basis: CountBasis = KEPT_BASIS): MeasuredCount {
  return measuredCount({
    numerator,
    denominator: basis.kept,
    unit: "sessions",
    timeframe: FIXTURE_WINDOW,
    basis,
  });
}

const LABEL = "left without going anywhere they could have gone";

function observation(numerator: number, label = LABEL, basis = KEPT_BASIS): Observation {
  return { label, count: countOf(numerator, basis) };
}

const VOCABULARY: DeliveryVocabulary = {
  nothingTodayLead:
    "We looked at what happened in your product, and we are not sending you anything today.",
  nothingToday: {
    one_already_open: "The last thing we sent is still waiting on an answer.",
    no_findings_ready: "We checked what happened and nothing was solid enough to send yet.",
    budget_spent: "We have already sent everything we will send for now.",
  },
  noRate: "Every session we looked at was set aside, so there is no share to report.",
};

type DeliverArm = Extract<SlackMessageInput, { decision: "deliver" }>;

function deliver(overrides: {
  surfacePath?: string;
  observations?: readonly Observation[];
}): DeliverArm {
  return {
    decision: "deliver",
    surfacePath: overrides.surfacePath ?? "/checkout/payment",
    observations: overrides.observations ?? [observation(3)],
    explanation: {
      source: "model_rendered",
      headline: "Sessions are stopping at the payment step.",
      context:
        "Most of what reaches this step does not continue past it, and the ones that stop do not come back to it afterwards.",
    },
  };
}

describe("renderCountSentence — a count never travels without its denominator", () => {
  test("renders a count with its denominator, never a bare number", () => {
    const sentence = renderCountSentence(observation(3), VOCABULARY);

    expect(sentence).toContain("3 of 28 sessions");
    expect(sentence).toContain(LABEL);
    expect(sentence).toContain("(11%)");

    expect(sentence).not.toMatch(/^3 sessions/);
  });

  test("should not render a session count as a people count", () => {
    const sentence = renderCountSentence(observation(3), VOCABULARY);

    expect(sentence).toContain("sessions");
    for (const noun of COHORT_NOUNS) {
      expect(new RegExp(`\\b${noun}\\b`, "i").test(sentence)).toBe(false);
    }
  });

  test("should not print 0% when every session in the window was set aside", () => {
    const sentence = renderCountSentence(observation(0, LABEL, ALL_SET_ASIDE_BASIS), VOCABULARY);

    expect(sentence).toBe(VOCABULARY.noRate);
    expect(sentence).not.toContain("%");
    expect(sentence).not.toContain("NaN");
    expect(sentence).not.toContain("Infinity");
  });

  test("should not print 0% for a numerator that rounds to zero", () => {
    const basis: CountBasis = { totalInWindow: 900, kept: 900, setAside: [] };
    const sentence = renderCountSentence(observation(3, LABEL, basis), VOCABULARY);

    expect(sentence).toContain("under 1%");
    expect(sentence).not.toContain("(0%)");
  });

  test("should not print 100% while some sessions did not do it", () => {
    const basis: CountBasis = { totalInWindow: 900, kept: 900, setAside: [] };
    const sentence = renderCountSentence(observation(899, LABEL, basis), VOCABULARY);

    expect(sentence).toContain("over 99%");
    expect(sentence).not.toContain("(100%)");
  });

  test("prints a true 0% and a true 100% without hedging", () => {
    const basis: CountBasis = { totalInWindow: 28, kept: 28, setAside: [] };
    expect(renderCountSentence(observation(0, LABEL, basis), VOCABULARY)).toContain("(0%)");
    expect(renderCountSentence(observation(28, LABEL, basis), VOCABULARY)).toContain("(100%)");
  });
});

describe("renderSlackMessage — the deliver arm", () => {
  test("renders the surface, the numbers, the written explanation and the window", () => {
    const message = renderSlackMessage(deliver({}), VOCABULARY);

    expect(message.text).toContain("/checkout/payment");
    expect(message.text).toContain("3 of 28 sessions");
    expect(message.text).toContain("Sessions are stopping at the payment step.");
    expect(message.text).toContain("Counted 28 of the 40 sessions we looked at.");
    expect(message.text).toContain(
      "12 set aside: 9 crawlers, monitors and scripts, 3 your own team.",
    );
    expect(message.text).toContain("Sessions from 1 June 2026 to 8 June 2026.");
    expect(message.blocks.length).toBeGreaterThan(1);
    expect(message.blocks.every((block) => block.text.trim().length > 0)).toBe(true);
  });

  test("renders each count as its own sentence with its own denominator", () => {
    const message = renderSlackMessage(
      deliver({
        observations: [observation(3), observation(5, "came back to this page more than once")],
      }),
      VOCABULARY,
    );

    const observationBlock = message.blocks[1];
    expect(observationBlock).toBeDefined();
    const lines = String(observationBlock?.text).split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain("of 28 sessions");
    }
    for (const connective of [" then ", "and then", "after that", "they went on"]) {
      expect(message.text.toLowerCase()).not.toContain(connective);
    }
  });

  test("renders a complete message when no written explanation exists", () => {
    const input: SlackMessageInput = {
      decision: "deliver",
      surfacePath: "/checkout/payment",
      observations: [observation(3)],
      explanation: { source: "floor_no_key_configured" },
    };

    const message = renderSlackMessage(input, VOCABULARY);

    expect(message.text).toContain("3 of 28 sessions");
    expect(message.text).toContain(SUMMARY_SOURCE_MESSAGES.floor_no_key_configured);
    expect(message.text.trim().endsWith(".")).toBe(true);
    expect(message.text).not.toContain("\n\n");
    expect(message.blocks.every((block) => block.text.trim().length > 0)).toBe(true);
  });

  test("should not spend a line saying an explanation exists when the explanation is right there", () => {
    const message = renderSlackMessage(deliver({}), VOCABULARY);
    expect(message.text).not.toContain(SUMMARY_SOURCE_MESSAGES.model_rendered);
  });

  test("drops model prose that calls sessions people and falls back to the numbers-only form", () => {
    const input: SlackMessageInput = {
      decision: "deliver",
      surfacePath: "/checkout/payment",
      observations: [observation(3)],
      explanation: {
        source: "model_rendered",
        headline: "Users are giving up at payment.",
        context: "Most people who reach this step never finish it.",
      },
    };

    const message = renderSlackMessage(input, VOCABULARY);

    expect(message.text).toContain(SUMMARY_SOURCE_MESSAGES.floor_model_text_rejected);
    expect(message.text).not.toContain("Users are giving up");
    expect(message.text).not.toContain("Most people");

    expect(message.text).toContain("3 of 28 sessions");
  });

  test("renders a customer's own path verbatim even when it contains a word our vocabulary bans", () => {
    const message = renderSlackMessage(
      deliver({ surfacePath: "/policy/users/step-2" }),
      VOCABULARY,
    );

    expect(message.text).toContain("/policy/users/step-2");
  });

  test("truncates a long surface path in the middle, keeping the tail that names the page", () => {
    const path = `/checkout/${"very-long-segment/".repeat(12)}step-two`;
    const message = renderSlackMessage(deliver({ surfacePath: path }), VOCABULARY);

    const heading = String(message.blocks[0]?.text).split("\n")[0];
    expect(String(heading).length).toBeLessThanOrEqual(SURFACE_PATH_BUDGET + 2);
    expect(message.text).toContain("/checkout/");
    expect(message.text).toContain("step-two");
    expect(message.text).toContain("…");
  });

  test("should not exceed the legibility budget with a long path and long prose", () => {
    const input: SlackMessageInput = {
      decision: "deliver",
      surfacePath: `/checkout/${"a".repeat(400)}/step-two`,
      observations: [
        observation(3, `${LABEL} ${"and did not come back to it either ".repeat(20)}`),
        observation(5, `came back to this page more than once ${"over and over ".repeat(20)}`),
        observation(7, `stopped part way through ${"again and again ".repeat(20)}`),
      ],
      explanation: {
        source: "model_rendered",
        headline: `Sessions are stopping at the payment step ${"in large numbers ".repeat(30)}`,
        context: `Most of what reaches this step does not continue past it ${"and it keeps going ".repeat(60)}`,
      },
    };

    const message = renderSlackMessage(input, VOCABULARY);

    expect(message.legibility.characters).toBeLessThanOrEqual(SLACK_MESSAGE_CHARACTER_BUDGET);
    expect(message.legibility.lines).toBeLessThanOrEqual(SLACK_MESSAGE_LINE_BUDGET);
    expect(message.legibility.characters).toBe(message.text.length);

    expect(renderSlackMessage(input, VOCABULARY).text).toBe(message.text);

    expect(message.text).toContain("3 of 28 sessions");
    expect(message.text).toContain("5 of 28 sessions");
    expect(message.text).toContain("7 of 28 sessions");
  });

  test("should not exceed the legibility budget for a count with no rate to report", () => {
    const input: SlackMessageInput = {
      decision: "deliver",
      surfacePath: "/checkout/payment",
      observations: [observation(0, LABEL, ALL_SET_ASIDE_BASIS)],
      explanation: { source: "floor_cap_exhausted" },
    };

    const message = renderSlackMessage(input, VOCABULARY);

    expect(message.text).toContain(VOCABULARY.noRate);
    expect(message.text).toContain("40 set aside");
    expect(message.text).not.toContain("%");
    expect(message.legibility.characters).toBeLessThanOrEqual(SLACK_MESSAGE_CHARACTER_BUDGET);
  });

  test("no rendered string contains product jargon", () => {
    const message = renderSlackMessage(deliver({}), VOCABULARY);
    const lower = message.text.toLowerCase();

    expect(FORBIDDEN_PRODUCT_JARGON.length).toBeGreaterThan(0);
    for (const word of FORBIDDEN_PRODUCT_JARGON) {
      expect(lower).not.toContain(word);
    }
  });

  test("the plaintext fallback carries no formatting markers", () => {
    const message = renderSlackMessage(deliver({}), VOCABULARY);

    expect(message.text).not.toContain("*");
    expect(message.blocks[0]?.text.startsWith("*")).toBe(true);
  });
});

describe("renderSlackMessage — what it refuses to render", () => {
  test("refuses an observation label that describes sessions as people", () => {
    expect(() =>
      renderSlackMessage(
        deliver({ observations: [observation(3, "users left without finishing")] }),
        VOCABULARY,
      ),
    ).toThrow();
  });

  test("refuses more counts than one message can carry", () => {
    const four = [observation(3), observation(5), observation(7), observation(9)];
    expect(four.length).toBeGreaterThan(MAX_OBSERVATIONS);
    expect(() => renderSlackMessage(deliver({ observations: four }), VOCABULARY)).toThrow();
  });

  test("refuses counts measured over two different windows in one message", () => {
    const later = measuredCount({
      numerator: 5,
      denominator: KEPT_BASIS.kept,
      unit: "sessions",
      timeframe: {
        start: new Date("2026-07-01T00:00:00.000Z"),
        end: new Date("2026-07-08T00:00:00.000Z"),
      },
      basis: KEPT_BASIS,
    });

    expect(() =>
      renderSlackMessage(
        deliver({
          observations: [observation(3), { label: "came back more than once", count: later }],
        }),
        VOCABULARY,
      ),
    ).toThrow();
  });

  test("refuses a count that was not built with its denominator", () => {
    const untyped: unknown = {
      decision: "deliver",
      surfacePath: "/checkout/payment",
      observations: [
        {
          label: LABEL,
          count: {
            numerator: 3,
            denominator: 28,
            unit: "sessions",
            timeframe: FIXTURE_WINDOW,
            basis: KEPT_BASIS,
          },
        },
      ],
      explanation: { source: "floor_cap_exhausted" },
    };

    expect(() => slackMessageInputSchema.parse(untyped)).toThrow();
  });

  test("refuses a deliver decision with no counts at all", () => {
    expect(() => renderSlackMessage(deliver({ observations: [] }), VOCABULARY)).toThrow();
  });
});

describe("renderSlackMessage — the nothing-today arm", () => {
  test("renders a real message for a quiet day, never an empty one", () => {
    for (const reason of nothingTodayReasonSchema.options) {
      const message = renderSlackMessage({ decision: "nothing_today", reason }, VOCABULARY);

      expect(message.blocks.length).toBeGreaterThan(0);
      expect(message.text.trim().length).toBeGreaterThan(20);
      expect(message.text).toContain(VOCABULARY.nothingTodayLead);
      expect(message.text).toContain(VOCABULARY.nothingToday[reason]);
      expect(message.legibility.characters).toBeLessThanOrEqual(SLACK_MESSAGE_CHARACTER_BUDGET);
    }
  });

  test("the three quiet days never render as the same message", () => {
    const rendered = nothingTodayReasonSchema.options.map(
      (reason: NothingTodayReason) =>
        renderSlackMessage({ decision: "nothing_today", reason }, VOCABULARY).text,
    );
    expect(new Set(rendered).size).toBe(rendered.length);
  });

  test("the fixture vocabulary is total over the reasons the shared enum declares", () => {
    expect(Object.keys(VOCABULARY.nothingToday).toSorted()).toEqual(
      [...nothingTodayReasonSchema.options].toSorted(),
    );
  });
});

describe("describesPeople — the gate on prose that would re-label a session", () => {
  test("flags every cohort noun the exported list names", () => {
    expect(COHORT_NOUNS.length).toBeGreaterThan(0);
    for (const noun of COHORT_NOUNS) {
      expect(describesPeople(`the ${noun} did not finish`)).toBe(true);
    }
  });

  test("should not flag a word that merely contains a cohort noun", () => {
    for (const text of [
      "these sessions were reusable",
      "the superusers table was not read",
      "personal details are masked upstream",
    ]) {
      expect(describesPeople(text)).toBe(false);
    }
  });

  test("does not decide anything about a surface path", () => {
    expect(describesPeople("/users/profile")).toBe(true);
    expect(
      renderSlackMessage(deliver({ surfacePath: "/users/profile" }), VOCABULARY).text,
    ).toContain("/users/profile");
  });
});

const ACTION_FINDING_ID = "fnd-t1sm-get-it-fixed";

const DELIVERY_SRC_DIR = join(import.meta.dir, "..", "..", "src", "delivery");

// Wave 2 widens the deliver arm with `findingId`; the assertion is the seam until it does.
function deliverWithFinding(): SlackMessageInput {
  return { ...deliver({}), findingId: ACTION_FINDING_ID } as SlackMessageInput;
}

function actionsBlockOf(blocks: readonly SlackBlock[]): SlackActionsBlock | undefined {
  return blocks.find((block): block is SlackActionsBlock => block.kind === "actions");
}

function deliverySources(): readonly { readonly file: string; readonly source: string }[] {
  return readdirSync(DELIVERY_SRC_DIR)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => ({
      file: name,
      source: readFileSync(join(DELIVERY_SRC_DIR, name), "utf8"),
    }));
}

describe("renderSlackMessage — the affordance that turns a finding into a fix", () => {
  test("names the interactivity action id from an exported constant", () => {
    const actions = actionsBlockOf(renderSlackMessage(deliverWithFinding(), VOCABULARY).blocks);

    expect(actions).toBeDefined();
    expect(actions?.actions.map((action) => action.actionId)).toEqual([GET_IT_FIXED_ACTION_ID]);

    const sources = deliverySources();
    expect(sources.length).toBeGreaterThan(1);
    expect(sources.some((entry) => entry.source.includes("GET_IT_FIXED_ACTION_ID"))).toBe(true);

    const inlined = sources
      .filter((entry) => entry.source.includes(GET_IT_FIXED_ACTION_ID))
      .map((entry) => entry.file);
    expect(inlined).toEqual([]);
  });

  test("carries the finding identity in the rendered action block", () => {
    const actions = actionsBlockOf(renderSlackMessage(deliverWithFinding(), VOCABULARY).blocks);

    expect(actions).toBeDefined();
    expect(actions?.blockId).toBe(`${FINDING_BLOCK_ID_PREFIX}${ACTION_FINDING_ID}`);
    expect(actions?.actions.map((action) => action.value)).toEqual([ACTION_FINDING_ID]);
  });
});
