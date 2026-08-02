import { describe, expect, test } from "bun:test";

import {
  CURRENT_EXCLUSION_RULE_SET,
  EXCLUSION_RULE_SETS,
  EXCLUSION_RULE_SET_VERSION,
  classifyExclusion,
} from "../../src/exclusions/classify";
import type { ExclusionRuleSet, SessionFacts } from "../../src/exclusions/types";

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

function ruleSetV1(): ExclusionRuleSet {
  const rules = EXCLUSION_RULE_SETS.get(1);
  if (!rules) throw new Error("rule set version 1 must remain resolvable forever");
  return rules;
}

describe("classifyExclusion — internal domain (F-3)", () => {
  test('returns "none" when the email domain is absent', () => {
    expect(
      classifyExclusion(
        sessionFacts({ identityEmailDomain: null, internalDomain: "acme.com" }),
        CURRENT_EXCLUSION_RULE_SET,
      ),
    ).toBe("none");

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

  test("matches exactly — acme.com.co and sub.acme.com do NOT match acme.com", () => {
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

    expect(
      classifyExclusion(
        sessionFacts({ identityEmailDomain: "acme.com", internalDomain: "acme.com" }),
        CURRENT_EXCLUSION_RULE_SET,
      ),
    ).toBe("internal_domain");
  });

  test("an unresolved identity is kept — never laundered into an exclusion", () => {
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
  test("the same session facts and rule-set version always yield the same exclusion reason", () => {
    const facts = sessionFacts({ identityEmailDomain: "acme.com", internalDomain: "acme.com" });

    const first = classifyExclusion(facts, ruleSetV1());
    const second = classifyExclusion(facts, ruleSetV1());
    const third = classifyExclusion({ ...facts }, ruleSetV1());

    expect(second).toBe(first);
    expect(third).toBe(first);

    const kept = sessionFacts({
      identityEmailDomain: "customer.example",
      internalDomain: "acme.com",
    });
    expect(classifyExclusion(kept, ruleSetV1())).toBe(classifyExclusion(kept, ruleSetV1()));
  });

  test("rule set version 1 remains resolvable and reproduces a v1 stamp after CURRENT advances", () => {
    const v1 = ruleSetV1();
    expect(v1.version).toBe(1);

    expect(EXCLUSION_RULE_SETS.get(EXCLUSION_RULE_SET_VERSION)).toBe(CURRENT_EXCLUSION_RULE_SET);
    expect(CURRENT_EXCLUSION_RULE_SET.version).toBe(EXCLUSION_RULE_SET_VERSION);

    for (let version = 1; version <= EXCLUSION_RULE_SET_VERSION; version += 1) {
      expect(EXCLUSION_RULE_SETS.get(version)?.version).toBe(version);
    }

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

    expect(facts).toEqual(snapshot);
  });
});
