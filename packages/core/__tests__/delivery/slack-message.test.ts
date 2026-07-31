// The Slack renderer (O-007). Every test name is an INVARIANT — the message a
// founder reads is the product's whole surface (product decisions §10), so
// these are the rows the renderer is judged against, not a description of its
// functions.
//
// FIXTURE TIME IS INJECTED, ALWAYS. `Date.now()` and no-arg `new Date()` appear
// nowhere here: a time-dependent test fails at 23:59 and looks exactly like a
// genuine red state.
//
// THE VOCABULARY IS A FIXTURE, AND ITS KEY SET IS ASSERTED. `packages/shared`
// exposes one entry point, so this package cannot import
// `src/delivery/messages.ts` directly — the renderer takes the vocabulary as an
// argument. The fixture below is therefore hand-written English, and the first
// test pins its key set against the SHARED enum, so a reason added upstream
// fails here rather than rendering nothing.
import { EXCLUSION_REASON_LABELS, FORBIDDEN_PRODUCT_JARGON } from "@growthmind/shared";
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
  SlackMessageInput,
} from "../../src/delivery/slack-message";

// --- fixtures ---------------------------------------------------------------

const FIXTURE_WINDOW = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-06-08T00:00:00.000Z"),
} as const;

function setAside(reason: ExclusionReason, count: number): SetAsideBasis {
  return { reason, count, label: EXCLUSION_REASON_LABELS[reason] };
}

/** 28 kept, 12 set aside, 40 in the window. 28 + 9 + 3 === 40. */
const KEPT_BASIS: CountBasis = {
  totalInWindow: 40,
  kept: 28,
  setAside: [setAside("automation_known_agent", 9), setAside("internal_domain", 3)],
};

/** ES-7: every session set aside. `kept = 0`, and 0 + 31 + 9 === 40. */
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

/**
 * The shape `DELIVERY_VOCABULARY` in `packages/shared/src/delivery/messages.ts`
 * satisfies. Written out as a literal so the `Record<NothingTodayReason, …>`
 * type is what makes it total — a new reason is a COMPILE error here.
 */
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

/** The deliver arm of the input union, so a fixture override stays typed. */
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

// --- the count sentence -----------------------------------------------------

describe("renderCountSentence — a count never travels without its denominator", () => {
  test("renders a count with its denominator, never a bare number", () => {
    const sentence = renderCountSentence(observation(3), VOCABULARY);

    expect(sentence).toContain("3 of 28 sessions");
    expect(sentence).toContain(LABEL);
    expect(sentence).toContain("(11%)");
    // The banned shape, stated: a numerator with no denominator beside it.
    expect(sentence).not.toMatch(/^3 sessions/);
  });

  test("should not render a session count as a people count", () => {
    // `../../src/counts/measured-count.ts:60-69` — identity stitching does not
    // exist in this product, so "3 of 28" means 3 of 28 SESSIONS. The unit is a
    // literal type on the count itself; this asserts the rendering obeys it.
    const sentence = renderCountSentence(observation(3), VOCABULARY);

    expect(sentence).toContain("sessions");
    for (const noun of COHORT_NOUNS) {
      expect(new RegExp(`\\b${noun}\\b`, "i").test(sentence)).toBe(false);
    }
  });

  test("should not print 0% when every session in the window was set aside", () => {
    // ES-7. A zero denominator is a real reportable state, so `rateOf` returns
    // `no_rate` and this sentence says so — never "0%", never NaN, never a
    // hidden divide.
    const sentence = renderCountSentence(observation(0, LABEL, ALL_SET_ASIDE_BASIS), VOCABULARY);

    expect(sentence).toBe(VOCABULARY.noRate);
    expect(sentence).not.toContain("%");
    expect(sentence).not.toContain("NaN");
    expect(sentence).not.toContain("Infinity");
  });

  test("should not print 0% for a numerator that rounds to zero", () => {
    // "3 of 900 sessions (0%)" reads as a rendering fault, and a founder who
    // reads it stops trusting every number beside it.
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

// --- the deliver arm --------------------------------------------------------

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
    // SAC-11 (`packages/shared/src/summary/messages.ts:23-61`): two clauses may
    // be about the same SURFACE and never about the same sessions. Each line
    // carries its own number, and this renderer inserts no connective between
    // them — no "then", no "and then", no pronoun handing one count the other's
    // behaviour.
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
    // A `floor_*` source means "numbers only" — the finding is identical, only
    // the prose is absent, and the message must still read as whole sentences
    // rather than as a gap where a paragraph should be.
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
    // FAIL DIRECTION, deliberately different from the label rule below: the
    // finding is true and the prose is not, so we keep the finding and lose the
    // prose. `floor_model_text_rejected` is the member that exists for exactly
    // this — "generated, but did not pass our accuracy check".
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
    // The finding itself is untouched.
    expect(message.text).toContain("3 of 28 sessions");
  });

  test("renders a customer's own path verbatim even when it contains a word our vocabulary bans", () => {
    // The jargon list governs OUR English. A customer's page is theirs: a
    // finding about a page we renamed is a finding nobody can act on, and the
    // cohort-noun guard never scans a path for the same reason.
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
    expect(String(heading).length).toBeLessThanOrEqual(SURFACE_PATH_BUDGET + 2); // + the two mrkdwn markers
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

    // Truncation is deterministic, not "whatever fitted this time".
    expect(renderSlackMessage(input, VOCABULARY).text).toBe(message.text);

    // What must survive the ladder: the surface and every count with its own
    // denominator. Prose shortens first; the claim never does.
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

// --- refusals ---------------------------------------------------------------

describe("renderSlackMessage — what it refuses to render", () => {
  test("refuses an observation label that describes sessions as people", () => {
    // FAIL DIRECTION: refuse. A label is OUR OWN code's vocabulary, so one
    // naming people would make every count it decorates a claim this product
    // cannot support. That is a caller bug, not a model's word choice.
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
    // The brand check, from the untyped side: a structurally identical object
    // literal is not a `MeasuredCount`, and the renderer must not be the place
    // that first admits one.
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

// --- the nothing-today arm --------------------------------------------------

describe("renderSlackMessage — the nothing-today arm", () => {
  test("renders a real message for a quiet day, never an empty one", () => {
    // `packages/shared/src/delivery/types.ts:16-32`: "we looked and there is
    // nothing for you today" is a POSITIVE answer a customer is owed. An empty
    // render would be the silence that union exists to prevent.
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
    // Non-vacuity for every test above: if the shared union grows a member, the
    // fixture is stale and this fails rather than a reason rendering nothing.
    expect(Object.keys(VOCABULARY.nothingToday).toSorted()).toEqual(
      [...nothingTodayReasonSchema.options].toSorted(),
    );
  });
});

// --- the cohort-noun gate ---------------------------------------------------

describe("describesPeople — the D10 gate on prose that would re-label a session", () => {
  test("flags every cohort noun the exported list names", () => {
    expect(COHORT_NOUNS.length).toBeGreaterThan(0);
    for (const noun of COHORT_NOUNS) {
      expect(describesPeople(`the ${noun} did not finish`)).toBe(true);
    }
  });

  test("should not flag a word that merely contains a cohort noun", () => {
    // Whole-word matching. A gate that fires on "superusers" or "reusable"
    // would withhold true prose, and withholding is not free here.
    for (const text of [
      "these sessions were reusable",
      "the superusers table was not read",
      "personal details are masked upstream",
    ]) {
      expect(describesPeople(text)).toBe(false);
    }
  });

  test("does not decide anything about a surface path", () => {
    // Stated as a test rather than a comment: the renderer never routes a path
    // through this gate, so a real `/users/profile` page renders untouched.
    expect(describesPeople("/users/profile")).toBe(true);
    expect(
      renderSlackMessage(deliver({ surfacePath: "/users/profile" }), VOCABULARY).text,
    ).toContain("/users/profile");
  });
});
