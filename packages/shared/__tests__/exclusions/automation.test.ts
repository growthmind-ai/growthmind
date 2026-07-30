// ADD §9 items 15–20 — the automation predicates and their near-miss fixtures
// (O-003 F-4 / F-5 / F-6 / F-7 / F-9, edge taxonomy D10).
//
// Fail directions under test:
//   F-4 headless/E2E   — CONFIDENT EXCLUDE, the one named exception.
//   F-5 known agent    — toward INCLUDING as real for anything ambiguous.
//   F-6 coding agent   — same, named separately so the counter can explain the
//                        gap in the customer's own terms.
//   F-7 absent UA      — toward INCLUDING as real. PostHog does not derive a
//                        user agent server-side (SEC-A), so a server-side or
//                        minimal SDK sends none at all.
//   F-9 host predicate — NOT BUILT, and its absence is asserted, not assumed.
//
// Every near-miss below is a regression guard against the substring rule a
// future contributor will be tempted to write. `Abbott` / `robotics` / `Botim`
// are the canonical conflation neighbours of a bare `bot` token.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  CODING_AGENT_TOKENS,
  HEADLESS_TOKENS,
  KNOWN_AGENT_TOKENS,
  matchesToken,
} from "../../src/exclusions/automation";
import { CURRENT_EXCLUSION_RULE_SET, classifyExclusion } from "../../src/exclusions/classify";
import { exclusionReasonSchema } from "../../src/exclusions/types";
import type { ExclusionReason, SessionFacts } from "../../src/exclusions/types";

/** An ordinary headed Chrome on Windows — a real person, the control case. */
const HEADED_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Classifies on the user agent alone: no email domain and no internal domain,
 * so the only predicate that can fire is an automation one. Keeps every
 * assertion below about the thing it names.
 */
function classifyUa(userAgent: string | null): ExclusionReason {
  const facts: SessionFacts = {
    identityEmailDomain: null,
    identityResolution: "unresolved",
    internalDomain: null,
    userAgent,
  };
  return classifyExclusion(facts, CURRENT_EXCLUSION_RULE_SET);
}

describe("matchesToken", () => {
  test("matches on whole tokens only, so a token inside a longer word never fires", () => {
    expect(matchesToken("curl/8.4.0", "curl")).toBe(true);
    expect(matchesToken("mozilla/5.0 curlyfont/2.0", "curl")).toBe(false);

    // The bare-`bot` conflation neighbours, asserted at the matcher level.
    expect(matchesToken("abbott/1.0", "bot")).toBe(false);
    expect(matchesToken("robotics-review/2.4", "bot")).toBe(false);
    expect(matchesToken("botim/12.4.1", "bot")).toBe(false);

    // Boundaries at both ends of the string, and around punctuation.
    expect(matchesToken("curl", "curl")).toBe(true);
    expect(matchesToken("(compatible; googlebot/2.1)", "googlebot")).toBe(true);
    expect(matchesToken("mozilla/5.0 chrome-lighthouse", "chrome-lighthouse")).toBe(true);
  });
});

describe("automation classification", () => {
  // Item 15 — F-4 and its near-miss.
  test("headless and E2E markers are a confident exclude; an ordinary headed Chrome UA is not", () => {
    for (const userAgent of [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Playwright/1.45",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Puppeteer/22.10",
      "Mozilla/5.0 (X11; Linux x86_64) Cypress/13.11.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) selenium/4.21 webdriver",
      "Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit/538.1 PhantomJS/2.1.1 Safari/538.1",
    ]) {
      expect(classifyUa(userAgent)).toBe("automation_headless");
    }

    // The near-miss that matters most: a real human on real Chrome.
    expect(classifyUa(HEADED_CHROME_UA)).toBe("none");
    // ...and a UA that merely mentions an automation-adjacent word inside a
    // longer token. Word-boundary matching, not substring.
    expect(
      classifyUa(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Seleniumesque/1.0",
      ),
    ).toBe("none");
  });

  // Item 16 — F-5 near-miss (REQUIRED).
  test("Abbott, robotics, and Botim do NOT fire any automation predicate", () => {
    // These exist to fail the day a contributor adds a bare `bot` token. They
    // are ordinary products with ordinary users, and setting their sessions
    // aside would erase real evidence invisibly.
    for (const userAgent of [
      `${HEADED_CHROME_UA} Abbott/1.0`,
      "Mozilla/5.0 (X11; Linux x86_64) robotics-review/2.4",
      "Botim/12.4.1 (iPhone; iOS 17.4)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AbbottDiagnostics/3.2",
    ]) {
      expect(classifyUa(userAgent)).toBe("none");
    }

    // The token lists must never contain a bare word that ordinary UAs carry.
    // This is the guard the fixtures above exist to trip.
    for (const list of [HEADLESS_TOKENS, KNOWN_AGENT_TOKENS, CODING_AGENT_TOKENS]) {
      for (const forbidden of ["bot", "agent", "test", "http", "api", "app", "web", "chrome"]) {
        expect(list).not.toContain(forbidden);
      }
      // Matching lowercases the UA first, so an uppercase token would be a
      // silent never-fires — a D9 stringly-typed no-op, not an error.
      for (const token of list) {
        expect(token).toBe(token.toLowerCase());
      }
    }
  });

  // Item 17 — F-5 near-miss (REQUIRED).
  test("Chrome-Lighthouse and Googlebot fire; an ordinary Chrome UA does not", () => {
    expect(
      classifyUa(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Chrome-Lighthouse",
      ),
    ).toBe("automation_known_agent");
    expect(
      classifyUa("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    ).toBe("automation_known_agent");
    expect(classifyUa("curl/8.4.0")).toBe("automation_known_agent");

    // Near-misses: the same UA without the auditor suffix, and a token that is
    // only a prefix of an ordinary word.
    expect(classifyUa(HEADED_CHROME_UA)).toBe("none");
    expect(classifyUa("Mozilla/5.0 (X11; Linux x86_64) curlyfont/2.0")).toBe("none");
  });

  // Item 18 — F-6 near-miss (REQUIRED).
  test('a UA merely containing the word "agent" does not fire the coding-agent predicate', () => {
    expect(classifyUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) user-agent-inspector/1.0")).toBe(
      "none",
    );
    expect(classifyUa("AgentSmithBrowser/3.1")).toBe("none");
    expect(classifyUa(`${HEADED_CHROME_UA} MyUserAgentString/2.0`)).toBe("none");

    // Control: a real coding agent is still named, and named as its own class
    // so the counter's breakdown can say so in the customer's terms.
    expect(classifyUa("Claude-User/1.0")).toBe("automation_coding_agent");
    expect(classifyUa("Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)")).toBe(
      "automation_coding_agent",
    );
  });

  // Item 19 — F-7.
  test('an absent or empty user agent classifies as "none", never as automation', () => {
    // SEC-A: PostHog does NOT derive a user agent server-side, so a
    // server-side or minimal SDK integration sends none at all. Classifying
    // that as a bot would silently drop real sessions — the exact D10
    // conflation this sprint exists to prevent.
    expect(classifyUa(null)).toBe("none");
    expect(classifyUa("")).toBe("none");
  });
});

// Item 20 — F-9. The predicate that is deliberately NOT built.
describe("no host-based or domain-pattern predicate exists in src/exclusions", () => {
  const EXCLUSIONS_DIR = join(import.meta.dir, "..", "..", "src", "exclusions");

  function sourceFiles(): { name: string; code: string }[] {
    return readdirSync(EXCLUSIONS_DIR)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => ({
        name,
        // Comments explain the absence; only executable code is searched.
        code: readFileSync(join(EXCLUSIONS_DIR, name), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/(^|[^:])\/\/.*$/gm, "$1"),
      }));
  }

  test("no exported symbol names a host, staging, or preview rule", () => {
    // A real early-stage product's production host genuinely IS
    // `something.vercel.app`. Such a predicate fires on a superset of its
    // target by construction, so it is not built — and that is asserted here
    // rather than left as a comment nobody re-reads.
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const exported = [
        ...file.code.matchAll(/export\s+(?:const|function|type|interface)\s+(\w+)/g),
      ]
        .map((match) => match[1] ?? "")
        .filter((name) => name.length > 0);
      for (const name of exported) {
        expect(`${file.name}:${name}`).not.toMatch(/host|staging|preview|vercel|netlify/i);
      }
    }
  });

  test("no host-pattern literal appears in executable code", () => {
    const markers = [
      "vercel",
      "netlify",
      "herokuapp",
      "onrender",
      "ngrok",
      "pages.dev",
      "staging",
      "hostname",
      "window.location",
      "$host",
      "$current_url",
    ];

    const violations: string[] = [];
    for (const file of sourceFiles()) {
      const lowered = file.code.toLowerCase();
      for (const marker of markers) {
        if (lowered.includes(marker)) violations.push(`${file.name}: ${marker}`);
      }
    }

    expect(violations).toEqual([]);
  });

  test("the exclusion reason union has no host, staging, or preview member", () => {
    // The stamp vocabulary is the contract O-004 onward reads. If no reason
    // can express a host exclusion, no writer can smuggle one in.
    for (const reason of exclusionReasonSchema.options) {
      expect(reason).not.toMatch(/host|staging|preview|url|path/i);
    }
    expect(exclusionReasonSchema.options).toEqual([
      "none",
      "internal_domain",
      "automation_headless",
      "automation_known_agent",
      "automation_coding_agent",
    ]);
  });
});
