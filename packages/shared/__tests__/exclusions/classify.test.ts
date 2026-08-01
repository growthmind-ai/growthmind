// items 13, 14, 21, 22, 23. The exclusion classifier's internal-domain predicate
// and its purity/versioning properties.
//
// F-3's fail direction: toward including as real. Over-exclusion is invisible, erases
// the evidence a finding rests on, and reads to the customer as "nobody uses my
// product". Under-exclusion is visible and cheaply re-marked by the later backfill.
// Asymmetric ⇒ fail open.
import { describe, expect, test } from "bun:test";

import {
  CURRENT_EXCLUSION_RULE_SET,
  EXCLUSION_RULE_SETS,
  EXCLUSION_RULE_SET_VERSION,
  classifyExclusion,
} from "../../src/exclusions/classify";
import type { ExclusionRuleSet, SessionFacts } from "../../src/exclusions/types";

/** An ordinary headed Chrome on Windows. A real person, the control case. */
const HEADED_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function sessionFacts(overrides: Partial<SessionFacts> = {}): SessionFacts {
  return {
    identityEmailDomain: null,
    identityResolution: "unresolved",
    internalDomain: null,
    userAgent: HEADED_CHROME_UA,
    ...overrides,
  };
}

/** The v1 rule set fetched by version, not by "whatever is current". */
function ruleSetV1(): ExclusionRuleSet {
  const rules = EXCLUSION_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

describe("classifyExclusion — internal domain (F-3)", () => {
  // Item 13, the majority path, not an edge case.
  //
  // Addendum a row 6 pinned `person` as null on 165/165 events: email is not on the
  // event at all, so most sessions carry no email and never will. This is what the
  // common request looks like, and it must be kept.
  test('returns "none" when the email domain is absent', () => {
    expect(
      classifyExclusion(
        sessionFacts({ identityEmailDomain: null, internalDomain: "acme.com" }),
        CURRENT_EXCLUSION_RULE_SET,
      ),
    ).toBe("none");

    // Every identity resolution state takes the same direction: we kept it.
    for (const identityResolution of ["unresolved", "absent", "resolved"] as const) {
      expect(
        classifyExclusion(
          sessionFacts({
            identityEmailDomain: null,
            identityResolution,
            internalDomain: "acme.com",
          }),
          CURRENT_EXCLUSION_RULE_SET,
        ),
      ).toBe("none");
    }
  });

  test('returns "none" when the project has no internal domain to match against', () => {
    // F-2 inferred nothing (free-mail or absent creator email). A session with a real
    // email must not be excluded against a domain we never established.
    expect(
      classifyExclusion(
        sessionFacts({ identityEmailDomain: "acme.com", internalDomain: null }),
        CURRENT_EXCLUSION_RULE_SET,
      ),
    ).toBe("none");
  });

  test("an exact domain match is the one case that excludes", () => {
    expect(
      classifyExclusion(
        sessionFacts({ identityEmailDomain: "acme.com", internalDomain: "acme.com" }),
        CURRENT_EXCLUSION_RULE_SET,
      ),
    ).toBe("internal_domain");
  });

  // Item 14, F-3 near-miss fixtures (required).
  test("matches exactly — acme.com.co and sub.acme.com do NOT match acme.com", () => {
    // A subdomain rule fires on `acme.com.attacker.net`; a suffix rule fires on
    // `acme.com.co`. Both are the superset failure this sprint exists to prevent, so
    // matching is whole-domain equality and nothing else.
    for (const identityEmailDomain of [
      "acme.com.co",
      "sub.acme.com",
      "mail.acme.com",
      "acme.com.attacker.net",
      "notacme.com",
      "acme.co",
      "acme.community",
      "xacme.com",
    ]) {
      expect(
        classifyExclusion(
          sessionFacts({ identityEmailDomain, internalDomain: "acme.com" }),
          CURRENT_EXCLUSION_RULE_SET,
        ),
      ).toBe("none");
    }

    // Control: the exact domain still excludes, so the test above is not passing merely
    // because the predicate never fires.
    expect(
      classifyExclusion(
        sessionFacts({ identityEmailDomain: "acme.com", internalDomain: "acme.com" }),
        CURRENT_EXCLUSION_RULE_SET,
      ),
    ).toBe("internal_domain");
  });

  test("an unresolved identity is kept — never laundered into an exclusion", () => {
    // F-8: "we could not check" is not "we checked and it is our own team". The counter
    // reports it separately; the classifier keeps it.
    expect(
      classifyExclusion(
        sessionFacts({
          identityEmailDomain: null,
          identityResolution: "unresolved",
          internalDomain: "acme.com",
        }),
        CURRENT_EXCLUSION_RULE_SET,
      ),
    ).toBe("none");
  });
});

describe("classifyExclusion — reproducibility", () => {
  // Item 21
  test("the same session facts and rule-set version always yield the same exclusion reason", () => {
    const facts = sessionFacts({ identityEmailDomain: "acme.com", internalDomain: "acme.com" });

    const first = classifyExclusion(facts, ruleSetV1());
    const second = classifyExclusion(facts, ruleSetV1());
    const third = classifyExclusion({ ...facts }, ruleSetV1());

    expect(second).toBe(first);
    expect(third).toBe(first);

    // Reproducing a stored stamp reads only persisted facts. The property the future
    // exclusions.backfill depends on, with zero PostHog access.
    const kept = sessionFacts({
      identityEmailDomain: "customer.example",
      internalDomain: "acme.com",
    });
    expect(classifyExclusion(kept, ruleSetV1())).toBe(classifyExclusion(kept, ruleSetV1()));
  });

  // Item 22 —.
  test("rule set version 1 remains resolvable and reproduces a v1 stamp after CURRENT advances", () => {
    const v1 = ruleSetV1();
    expect(v1.version).toBe(1);

    // The version travels inside the rule set, so a caller holding a stored
    // `exclusion_rule_set_version` can always fetch exactly what stamped it.
    expect(EXCLUSION_RULE_SETS.get(EXCLUSION_RULE_SET_VERSION)).toBe(CURRENT_EXCLUSION_RULE_SET);
    expect(CURRENT_EXCLUSION_RULE_SET.version).toBe(EXCLUSION_RULE_SET_VERSION);

    // Every version ever shipped stays in the map. This assertion is what fails when a
    // future contributor edits v1 in place instead of adding v2.
    for (let version = 1; version <= EXCLUSION_RULE_SET_VERSION; version += 1) {
      expect(EXCLUSION_RULE_SETS.get(version)?.version).toBe(version);
    }

    // Classified against the explicitly-fetched v1 rules. This expectation stays true
    // when EXCLUSION_RULE_SET_VERSION becomes 2.
    expect(
      classifyExclusion(
        sessionFacts({ identityEmailDomain: "acme.com", internalDomain: "acme.com" }),
        v1,
      ),
    ).toBe("internal_domain");
    expect(
      classifyExclusion(
        sessionFacts({ identityEmailDomain: "acme.com.co", internalDomain: "acme.com" }),
        v1,
      ),
    ).toBe("none");
  });

  // Item 23, (iii).
  test("performs no I/O, reads no clock, and uses no randomness", () => {
    const realNow = Date.now;
    const realRandom = Math.random;
    const realFetch = globalThis.fetch;

    let clockReads = 0;
    let randomReads = 0;
    let fetchCalls = 0;

    Date.now = () => {
      clockReads += 1;
      return realNow.call(Date);
    };
    Math.random = () => {
      randomReads += 1;
      return realRandom.call(Math);
    };
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      fetchCalls += 1;
      return realFetch(...args);
    }) as typeof fetch;

    const facts = sessionFacts({ identityEmailDomain: "acme.com", internalDomain: "acme.com" });
    const snapshot = { ...facts };

    try {
      const reason = classifyExclusion(facts, CURRENT_EXCLUSION_RULE_SET);
      expect(reason).toBe("internal_domain");
    } finally {
      Date.now = realNow;
      Math.random = realRandom;
      globalThis.fetch = realFetch;
    }

    expect(clockReads).toBe(0);
    expect(randomReads).toBe(0);
    expect(fetchCalls).toBe(0);
    // Pure also means it does not mutate what it was handed.
    expect(facts).toEqual(snapshot);
  });
});
