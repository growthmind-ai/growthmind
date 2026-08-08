// The sibling of `onboarding/messages.test.ts`, for the connection cards' own copy module.
// Without it `ALL_CONNECTION_MESSAGES` is an array nothing walks: the file is clean today by
// discipline alone, and the next constant added and forgotten from the array is invisible to
// every gate in the repo.
import { describe, expect, test } from "bun:test";

import * as connectionMessages from "../../src/connections/messages";
import { FORBIDDEN_PRODUCT_JARGON } from "../../src/signatures/messages";

const DURATION = /\d+\s*(s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b/i;

// The onboarding audit bans a bare `\babout\b`, which here would fire on "this is the
// product every finding is about" — concerning, not approximately. Anchored to a time
// word instead, so it means what R-LATENCY means.
const TIME_HEDGE =
  /\b(about|around|roughly|approx\w*|usually|typically|~)(?:\s+\w+){0,3}\s+(second|minute|hour|day)s?\b/i;

// The stricter half, and the one a digit-based rule misses: "a minute or two" commits to
// a duration in prose without ever writing a number.
const WORDED_DURATION = /\b(an?|one|two|few|couple|several)\s+(second|minute|hour|day)s?\b/i;

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

const APOLOGETIC = /\bsorry\b|\bunfortunately\b|!/i;

// Only these two may name a vendor, and they are the whole point of this module — the
// change it belongs to exists because the screen named a hostname instead of a product.
const SANCTIONED_PROPER_NOUNS = ["PostHog", "Slack"] as const;

const namespace = connectionMessages as unknown as Record<string, unknown>;

function derivedFromExports(): string[] {
  const derived: string[] = [];

  for (const [name, value] of Object.entries(namespace)) {
    if (name === "ALL_CONNECTION_MESSAGES") continue;

    // A map into the `ConnectionTone` union, not copy: "off" and "live" are values the
    // renderer branches on, and nobody reads them.
    if (name === "ANALYTICS_STATUS_TONES") continue;

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

function registered(): string[] {
  const all = namespace.ALL_CONNECTION_MESSAGES;

  if (!Array.isArray(all)) {
    throw new Error(
      "connections/messages.ts exports no ALL_CONNECTION_MESSAGES array, so this audit has " +
        "nothing total to walk — and a best-effort copy audit is the one that misses the " +
        "string that ships.",
    );
  }

  return all.filter((entry): entry is string => typeof entry === "string");
}

const offendersFor = (tokens: readonly string[]): string[] => {
  const found: string[] = [];

  for (const message of registered()) {
    for (const token of tokens) {
      if (new RegExp(`\\b${token}\\b`, "i").test(message)) {
        found.push(`${token} in: ${message}`);
      }
    }
  }

  return found;
};

describe("the connection cards' copy is registered and walkable", () => {
  // The load-bearing row: an exported constant absent from the array escapes every check
  // below it, which is exactly how a copy module goes quietly bad.
  test("every exported string is registered in ALL_CONNECTION_MESSAGES", () => {
    const known = new Set(registered());
    const unregistered = derivedFromExports().filter((message) => !known.has(message));

    expect(unregistered).toEqual([]);
  });

  // Not uniqueness: two constants may legitimately carry the same words — "Not connected"
  // is both an analytics status and a delivery status, and collapsing them would make one
  // card's wording depend on the other's.
  test("the registry is non-empty and covers every distinct string", () => {
    const all = registered();

    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all).size).toBe(new Set(derivedFromExports()).size);
  });
});

describe("the connection cards' copy is plain English", () => {
  test("no string contains product jargon", () => {
    expect(FORBIDDEN_PRODUCT_JARGON.length).toBeGreaterThan(0);
    expect(offendersFor(FORBIDDEN_PRODUCT_JARGON)).toEqual([]);
  });

  test("no string contains engineering jargon", () => {
    expect(offendersFor(ENGINEERING_JARGON)).toEqual([]);
  });

  // A card states how long ago something happened from a real timestamp. It must never
  // promise how long the next one will take.
  test("no string commits to a duration or hedges about one", () => {
    // Controls, so the three rules cannot pass by matching nothing.
    expect("Events arrive within 85 seconds.").toMatch(DURATION);
    expect("This takes about half a minute.").toMatch(TIME_HEDGE);
    expect("This takes a minute or two.").toMatch(WORDED_DURATION);
    expect("This is the product every finding is about.").not.toMatch(TIME_HEDGE);

    const messages = registered();

    expect(messages.filter((message) => DURATION.test(message))).toEqual([]);
    expect(messages.filter((message) => TIME_HEDGE.test(message))).toEqual([]);
    expect(messages.filter((message) => WORDED_DURATION.test(message))).toEqual([]);
  });

  test("no string apologises or shouts", () => {
    expect(registered().filter((message) => APOLOGETIC.test(message))).toEqual([]);
  });

  // The module is allowed to name PostHog and Slack, and nothing else. A third vendor
  // appearing in copy is a product decision, and should cost an edit to this list.
  test("only the two sanctioned vendors are named", () => {
    const capitalised = /\b[A-Z][a-zA-Z]{2,}\b/g;
    const allowed = new Set<string>(SANCTIONED_PROPER_NOUNS);

    const strays: string[] = [];
    for (const message of registered()) {
      // Every sentence's opening word is ordinary prose, not a name — and these sentences
      // run to two and three, so exempting only the first would flag "This" and "Pick".
      const sentences = message
        .replace(/\{[^}]*\}/g, "")
        .split(/(?:[.!?]|—)\s+/)
        .filter((part) => part.trim() !== "");

      for (const sentence of sentences) {
        for (const word of sentence.match(capitalised) ?? []) {
          if (!allowed.has(word) && !sentence.trim().startsWith(word)) {
            strays.push(`${word} in: ${message}`);
          }
        }
      }
    }

    expect(strays).toEqual([]);
  });
});
