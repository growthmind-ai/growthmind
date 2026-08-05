import type { ResidualPiiKind } from "@growthmind/shared";
import { RESIDUAL_PII_KINDS } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import type { FindingText, FindingTextInput } from "../../src/delivery/finding-text";
import { joinScanned, reviewFindingText, trimScanned } from "../../src/delivery/finding-text";

type CleanVerdict = Extract<FindingText, { held: false }>;
type HeldVerdict = Extract<FindingText, { held: true }>;
type PiiVerdict = Extract<FindingText, { why: "residual_pii" }>;

const OFFENDERS: Record<ResidualPiiKind, string> = {
  email_address: "jane.doe@acme.example",
  phone_number: "+44 7700 900123",
  payment_card: "4111 1111 1111 1111",
  ip_address: "203.0.113.42",
  credential: "sk-fixture-NeverARealKeyAAAA",
};

const CLEAN_HEADLINE = "Sign-up stalled at the pricing page.";

const CLEAN_CONTEXT = [
  "Two of eleven visits ended without going onward.",
  "Nothing else about this run looks unusual.",
] as const;

// Composing the input throws where the scan would otherwise read it, without
// touching the real scanner.
const UNREADABLE_ELEMENT: string = {
  toString(): string {
    throw new Error("scan_input_unreadable");
  },
} as unknown as string;

function headlineCarrying(offender: string): string {
  return `Sign-up stalled at ${offender} on the pricing page.`;
}

function cleanVerdict(verdict: FindingText): CleanVerdict {
  if (verdict.held) {
    throw new Error(`expected a clean verdict, received a hold: ${verdict.why}`);
  }
  return verdict;
}

function heldVerdict(verdict: FindingText): HeldVerdict {
  if (!verdict.held) {
    throw new Error("expected a hold, received a clean verdict");
  }
  return verdict;
}

function piiVerdict(verdict: FindingText): PiiVerdict {
  const held = heldVerdict(verdict);
  if (held.why !== "residual_pii") {
    throw new Error(`expected a residual_pii hold, received "${held.why}"`);
  }
  return held;
}

const FRAGMENT_FLOOR = 4;

function fragmentsOf(text: string): readonly string[] {
  const lowered = text.toLowerCase();
  const fragments: string[] = [];

  for (let start = 0; start + FRAGMENT_FLOOR <= lowered.length; start += 1) {
    for (let end = start + FRAGMENT_FLOOR; end <= lowered.length; end += 1) {
      fragments.push(lowered.slice(start, end));
    }
  }

  return fragments;
}

describe("reviewFindingText", () => {
  test("a clean headline and context are carried through unchanged on the not-held arm", () => {
    const verdict = cleanVerdict(
      reviewFindingText({ headline: CLEAN_HEADLINE, context: CLEAN_CONTEXT }),
    );

    // Widening ScannedText to string is the sanctioned direction, and these two
    // annotations are the compile-time proof that it stays open.
    const headline: string = verdict.headline;
    const context: readonly string[] = verdict.context;

    expect(headline).toBe(CLEAN_HEADLINE);
    expect(context).toEqual([...CLEAN_CONTEXT]);
  });

  for (const kind of RESIDUAL_PII_KINDS) {
    test(`a planted ${kind} offender is held as residual_pii carrying that kind`, () => {
      const verdict = reviewFindingText({
        headline: headlineCarrying(OFFENDERS[kind]),
        context: CLEAN_CONTEXT,
      });

      expect(piiVerdict(verdict).kind).toBe(kind);
    });
  }

  test("an offender in the second context element alone is caught, because one verdict covers headline and context together", () => {
    const verdict = reviewFindingText({
      headline: CLEAN_HEADLINE,
      context: [
        CLEAN_CONTEXT[0],
        `Nothing else about this run looks unusual, apart from ${OFFENDERS.ip_address}.`,
      ],
    });

    expect(piiVerdict(verdict).kind).toBe("ip_address");
  });

  test("a scan that throws is held as unreadable and never returns a clean verdict", () => {
    const verdict = reviewFindingText({
      headline: CLEAN_HEADLINE,
      context: [UNREADABLE_ELEMENT],
    });

    expect(heldVerdict(verdict).why).toBe("unreadable");
    expect("headline" in verdict).toBe(false);
  });

  test("no held verdict, serialised, carries the planted offender or any fragment of the text it was given", () => {
    const inputs: readonly FindingTextInput[] = [
      ...RESIDUAL_PII_KINDS.map((kind) => ({
        headline: headlineCarrying(OFFENDERS[kind]),
        context: CLEAN_CONTEXT,
      })),
      { headline: CLEAN_HEADLINE, context: [UNREADABLE_ELEMENT] },
    ];

    const leaked: string[] = [];

    for (const input of inputs) {
      const serialised = JSON.stringify(heldVerdict(reviewFindingText(input))).toLowerCase();
      const readable = [input.headline, ...input.context]
        .filter((element) => element !== UNREADABLE_ELEMENT)
        .join("\n");

      leaked.push(...fragmentsOf(readable).filter((fragment) => serialised.includes(fragment)));
    }

    expect(leaked).toEqual([]);
  });
});

describe("reviewFindingText — element types are checked before anything is branded", () => {
  test("a non-string element is held rather than coerced by the join and branded as itself", () => {
    const verdict = reviewFindingText({
      headline: CLEAN_HEADLINE,
      context: [CLEAN_CONTEXT[0], 42 as unknown as string],
    });

    // The scan reads a join, and a join coerces: without the check this element passes
    // the scan as "42" and is then branded as scanned text it never was.
    expect(heldVerdict(verdict).why).toBe("unreadable");
    expect("context" in verdict).toBe(false);
  });

  test("a context that is not an array at all is held rather than spread", () => {
    const verdict = reviewFindingText({
      headline: CLEAN_HEADLINE,
      context: CLEAN_CONTEXT[0] as unknown as readonly string[],
    });

    expect(heldVerdict(verdict).why).toBe("unreadable");
  });

  test("every element of a clean verdict's context is a string", () => {
    const verdict = cleanVerdict(
      reviewFindingText({ headline: CLEAN_HEADLINE, context: CLEAN_CONTEXT }),
    );

    expect(verdict.context.map((part) => typeof part)).toEqual(["string", "string"]);
  });
});

describe("joinScanned", () => {
  test("scanned parts join to the same string Array.join produces", () => {
    const verdict = cleanVerdict(
      reviewFindingText({ headline: CLEAN_HEADLINE, context: CLEAN_CONTEXT }),
    );

    const joined: string = joinScanned(verdict.context, " ");

    expect(joined).toBe(CLEAN_CONTEXT.join(" "));
  });

  test("no parts join to an empty string rather than throwing", () => {
    const joined: string = joinScanned([], " ");

    expect(joined).toBe("");
  });

  test("a single part joins to itself, with the separator left out", () => {
    const verdict = cleanVerdict(
      reviewFindingText({ headline: CLEAN_HEADLINE, context: [CLEAN_CONTEXT[0]] }),
    );

    const joined: string = joinScanned(verdict.context, " | ");

    expect(joined).toBe(CLEAN_CONTEXT[0]);
  });

  test("the joined result is itself scannable text a reviewer still finds clean", () => {
    const verdict = cleanVerdict(
      reviewFindingText({ headline: CLEAN_HEADLINE, context: CLEAN_CONTEXT }),
    );

    const rescanned = reviewFindingText({
      headline: verdict.headline,
      context: [joinScanned(verdict.context, " ")],
    });

    expect(rescanned.held).toBe(false);
  });
});

describe("trimScanned", () => {
  const padded = (...context: readonly string[]) =>
    cleanVerdict(reviewFindingText({ headline: CLEAN_HEADLINE, context })).context;

  test("surrounding whitespace goes, and the result is still scanned text", () => {
    const joined = joinScanned(padded("", CLEAN_CONTEXT[0]), " ");
    const before: string = joined;

    // Feeding the result back into `joinScanned` only compiles if the brand survived,
    // so this line is the compile-time half of the assertion.
    const trimmed: string = joinScanned([trimScanned(joined)], "");

    expect(before).toBe(` ${CLEAN_CONTEXT[0]}`);
    expect(trimmed).toBe(CLEAN_CONTEXT[0]);
  });

  test("text with nothing to trim comes back unchanged", () => {
    const trimmed: string = trimScanned(joinScanned(padded(CLEAN_CONTEXT[0]), " "));

    expect(trimmed).toBe(CLEAN_CONTEXT[0]);
  });

  test("text that is only separators trims to empty, which is what an emptiness test reads", () => {
    const joined = joinScanned(padded("", ""), " ");
    const before: string = joined;
    const trimmed: string = trimScanned(joined);

    expect(before).toBe(" ");
    expect(trimmed).toBe("");
  });
});
