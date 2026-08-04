import { describe, expect, test } from "bun:test";

import * as findingsMessages from "../../src/findings/messages";
import {
  ALL_FINDINGS_MESSAGES,
  CALIBRATION_NONE_YET,
  calibrationSentence,
  coverageSentences,
  cohortLine,
  sessionLabel,
} from "../../src/findings/messages";
import { FORBIDDEN_PRODUCT_JARGON } from "../../src/signatures/messages";

const DURATION = /\d+\s*(s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b/i;
const HEDGE = /\babout\b|\busually\b|\btypically\b|\bapprox|~/i;
const APOLOGETIC = /\bsorry\b|\bunfortunately\b|!/i;
const BARE_STATUS = /\b[1-5]\d{2}\b/;

const ENGINEERING_JARGON = [
  "tenant",
  "adapter",
  "endpoint",
  "null",
  "undefined",
  "schema",
  "payload",
  "idempotent",
  "watermark",
  "upsert",
  "jsonb",
] as const;

const UX_BANNED_WORDS = [
  "scout",
  "signal",
  "ingest",
  "pipeline",
  "surface",
  "signature",
  "SDK",
  "MCP",
] as const;

function derivedFromExports(): string[] {
  const derived: string[] = [];

  for (const [name, value] of Object.entries(findingsMessages)) {
    if (name === "ALL_FINDINGS_MESSAGES") continue;

    if (typeof value === "string") {
      derived.push(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const entry of Object.values(value)) {
        if (typeof entry === "string") derived.push(entry);
      }
    }
  }

  return derived;
}

describe("the findings copy audit", () => {
  test("every exported string is registered in ALL_FINDINGS_MESSAGES", () => {
    const registered = new Set(ALL_FINDINGS_MESSAGES);
    const missing = derivedFromExports().filter((message) => !registered.has(message));

    expect(missing).toEqual([]);
    expect(registered.size).toBeGreaterThan(0);
  });

  test("no string commits to a duration or hedges a quantity", () => {
    expect("Events arrive within 85 seconds.").toMatch(DURATION);
    expect("This takes about a minute.").toMatch(HEDGE);

    expect(ALL_FINDINGS_MESSAGES.filter((message) => DURATION.test(message))).toEqual([]);
    expect(ALL_FINDINGS_MESSAGES.filter((message) => HEDGE.test(message))).toEqual([]);
  });

  test("no string carries engineering or product jargon", () => {
    const banned = [...ENGINEERING_JARGON, ...UX_BANNED_WORDS, ...FORBIDDEN_PRODUCT_JARGON];
    const offenders: string[] = [];

    for (const message of ALL_FINDINGS_MESSAGES) {
      for (const token of banned) {
        if (message.toLowerCase().includes(token.toLowerCase())) {
          offenders.push(`${token} in: ${message}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no string apologises or shows a bare response code", () => {
    expect(ALL_FINDINGS_MESSAGES.filter((message) => APOLOGETIC.test(message))).toEqual([]);
    expect(ALL_FINDINGS_MESSAGES.filter((message) => BARE_STATUS.test(message))).toEqual([]);
  });
});

describe("coverageSentences", () => {
  const full = {
    sessionsRead: 1104,
    sessionsSetAside: 312,
    found: 11,
    explained: 4,
    described: 3,
    withheld: 2,
  };

  test("states what was read, found, explained and withheld", () => {
    const sentences = coverageSentences(full);

    expect(sentences.join(" ")).toContain("1104 sessions");
    expect(sentences.join(" ")).toContain("312");
    expect(sentences.join(" ")).toContain("11 things");
    expect(sentences.join(" ")).toContain("2 we are not showing you");
  });

  test("a quiet week reads as a complete account, not an account with holes", () => {
    const sentences = coverageSentences({ ...full, found: 0, explained: 0, described: 0, withheld: 0 });

    expect(sentences).toHaveLength(2);
    expect(sentences[1]).toBe("We found nothing worth telling you.");

    // The clauses that would each carry a zero are absent, not rendered as "0 of them".
    expect(sentences.join(" ")).not.toContain("we can only describe");
    expect(sentences.join(" ")).not.toContain("not showing you");
  });

  test("withholding nothing never renders a zero withheld clause", () => {
    const sentences = coverageSentences({ ...full, withheld: 0 });

    expect(sentences.join(" ")).not.toContain("not showing you");
  });

  test("explaining nothing still states what was described", () => {
    const sentences = coverageSentences({ ...full, explained: 0, described: 11, withheld: 0 });

    expect(sentences.join(" ")).toContain("We can explain 0 of them; 11 we can only describe.");
  });
});

describe("calibrationSentence", () => {
  test("states how the calls we already made turned out", () => {
    expect(calibrationSentence({ right: 4, wrong: 1, pending: 1 })).toBe(
      "We have made 6 calls on your product. 4 played out the way we said, 1 did not, and 1 cannot be read yet.",
    );
  });

  test("counts an unreadable outcome as a call, never rounds it away", () => {
    const sentence = calibrationSentence({ right: 0, wrong: 0, pending: 3 });

    expect(sentence).toContain("3 calls");
    expect(sentence).toContain("3 cannot be read yet");
  });

  test("a single call reads as one call, not as 1 calls", () => {
    expect(calibrationSentence({ right: 1, wrong: 0, pending: 0 })).toContain("1 call on");
  });

  test("says so plainly before any call has been made", () => {
    expect(calibrationSentence({ right: 0, wrong: 0, pending: 0 })).toBe(CALIBRATION_NONE_YET);
  });

  test("never hides a wrong call behind a total", () => {
    expect(calibrationSentence({ right: 1, wrong: 9, pending: 0 })).toContain("9 did not");
  });
});

describe("the parameterised builders", () => {
  test("sessionLabel numbers a session", () => {
    expect(sessionLabel(3)).toBe("Session 3");
  });

  test("cohortLine names the count and the moment the paths split", () => {
    expect(cohortLine({ count: 96, when: "00:11" })).toBe(
      "96 people got through — their path diverged at 00:11.",
    );
  });
});
