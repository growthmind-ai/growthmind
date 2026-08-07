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

const HEADED_CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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

    expect(matchesToken("abbott/1.0", "bot")).toBe(false);
    expect(matchesToken("robotics-review/2.4", "bot")).toBe(false);
    expect(matchesToken("botim/12.4.1", "bot")).toBe(false);

    expect(matchesToken("curl", "curl")).toBe(true);
    expect(matchesToken("(compatible; googlebot/2.1)", "googlebot")).toBe(true);
    expect(matchesToken("mozilla/5.0 chrome-lighthouse", "chrome-lighthouse")).toBe(true);
  });
});

describe("automation classification", () => {
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

    expect(classifyUa(HEADED_CHROME_UA)).toBe("none");

    expect(
      classifyUa(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Seleniumesque/1.0",
      ),
    ).toBe("none");
  });

  test("Abbott, robotics, and Botim do NOT fire any automation predicate", () => {
    for (const userAgent of [
      `${HEADED_CHROME_UA} Abbott/1.0`,
      "Mozilla/5.0 (X11; Linux x86_64) robotics-review/2.4",
      "Botim/12.4.1 (iPhone; iOS 17.4)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AbbottDiagnostics/3.2",
    ]) {
      expect(classifyUa(userAgent)).toBe("none");
    }

    for (const list of [HEADLESS_TOKENS, KNOWN_AGENT_TOKENS, CODING_AGENT_TOKENS]) {
      for (const forbidden of ["bot", "agent", "test", "http", "api", "app", "web", "chrome"]) {
        expect(list).not.toContain(forbidden);
      }

      for (const token of list) {
        expect(token).toBe(token.toLowerCase());
      }
    }
  });

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

    expect(classifyUa(HEADED_CHROME_UA)).toBe("none");
    expect(classifyUa("Mozilla/5.0 (X11; Linux x86_64) curlyfont/2.0")).toBe("none");
  });

  test('a UA merely containing the word "agent" does not fire the coding-agent predicate', () => {
    expect(classifyUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) user-agent-inspector/1.0")).toBe(
      "none",
    );
    expect(classifyUa("AgentSmithBrowser/3.1")).toBe("none");
    expect(classifyUa(`${HEADED_CHROME_UA} MyUserAgentString/2.0`)).toBe("none");

    expect(classifyUa("Claude-User/1.0")).toBe("automation_coding_agent");
    expect(classifyUa("Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)")).toBe(
      "automation_coding_agent",
    );
  });

  test('an absent or empty user agent classifies as "none", never as automation', () => {
    expect(classifyUa(null)).toBe("none");
    expect(classifyUa("")).toBe("none");
  });
});

describe("no host-based or domain-pattern predicate exists in src/exclusions", () => {
  const EXCLUSIONS_DIR = join(import.meta.dir, "..", "..", "src", "exclusions");

  function sourceFiles(): { name: string; code: string }[] {
    return readdirSync(EXCLUSIONS_DIR)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => ({
        name,

        code: readFileSync(join(EXCLUSIONS_DIR, name), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/(^|[^:])\/\/.*$/gm, "$1"),
      }));
  }

  test("no exported symbol names a host, staging, or preview rule", () => {
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
    for (const reason of exclusionReasonSchema.options) {
      expect(reason).not.toMatch(/host|staging|preview|url|path/i);
    }
    expect(exclusionReasonSchema.options).toEqual([
      "none",
      "internal_domain",
      "automation_headless",
      "automation_known_agent",
      "automation_coding_agent",
      "outside_who_counts",
    ]);
  });
});

describe("a user-initiated fetch is a real session (B-008)", () => {
  // Both vendors document these as a request a person asked for. F-6's declared fail direction
  // is that anything ambiguous is INCLUDED as real, so excluding them contradicted the rule the
  // file states about itself, and every session they covered was erased from the evidence
  // behind a finding — an under-count that reads to a founder as a product problem.
  // The user agents each vendor documents, verbatim, including the +url every OpenAI agent
  // carries. The url is why removing `chatgpt-user` alone changed nothing: the bare `openai`
  // token matched through it.
  const CHATGPT_USER =
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; " +
    "+https://openai.com/bot";
  const PERPLEXITY_USER =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0.0.0 Safari/537.36; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user";
  const GPTBOT =
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; " +
    "+https://openai.com/gptbot";
  const OAI_SEARCHBOT =
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; " +
    "+https://openai.com/searchbot";

  test("ChatGPT-User and Perplexity-User are counted, while the crawlers beside them are not", () => {
    expect(classifyUa(CHATGPT_USER)).toBe("none");
    expect(classifyUa(PERPLEXITY_USER)).toBe("none");

    // The near neighbours, which are crawls rather than errands, still fire — and each on its
    // own token now that the vendor name is not standing in for all three.
    expect(classifyUa(GPTBOT)).toBe("automation_coding_agent");
    expect(classifyUa(OAI_SEARCHBOT)).toBe("automation_coding_agent");
    expect(classifyUa("Mozilla/5.0 (compatible; PerplexityBot/1.0)")).toBe(
      "automation_coding_agent",
    );
    expect(classifyUa("Mozilla/5.0 (compatible; ClaudeBot/1.0)")).toBe("automation_coding_agent");
  });

  test("no token is left that matches a vendor url rather than an agent", () => {
    for (const list of [HEADLESS_TOKENS, KNOWN_AGENT_TOKENS, CODING_AGENT_TOKENS]) {
      expect(list).not.toContain("chatgpt-user");
      expect(list).not.toContain("perplexity-user");

      // A bare vendor name is a superset of every agent that vendor ships, so it re-excludes
      // the user-initiated ones through the +url in their user agent.
      expect(list).not.toContain("openai");
    }

    expect(matchesToken(CHATGPT_USER, "openai")).toBe(true);
  });
});

describe("every token is exact, one token at a time (B-008)", () => {
  // The fixtures this file already had are per-CLASS: one member stands for the list. The k6
  // incident was per-TOKEN — one entry firing on a superset of its target — so the check that
  // would have caught it has to visit each entry. `matchesToken` is asserted rather than
  // `classifyExclusion` because a composite token like `chrome-headless-shell` legitimately
  // contains `headless`, and a class-level assertion could not tell the two apart.
  const EVERY_TOKEN: readonly (readonly [string, string])[] = [
    ...HEADLESS_TOKENS.map((token) => ["headless", token] as const),
    ...KNOWN_AGENT_TOKENS.map((token) => ["known agent", token] as const),
    ...CODING_AGENT_TOKENS.map((token) => ["coding agent", token] as const),
  ];

  test("each token fires on its own word boundary and never inside a longer one", () => {
    expect(EVERY_TOKEN.length).toBeGreaterThan(0);

    for (const [list, token] of EVERY_TOKEN) {
      const onItsOwn = `Mozilla/5.0 (compatible; ${token}/1.0)`;
      expect({ list, token, fires: matchesToken(onItsOwn, token) }).toEqual({
        list,
        token,
        fires: true,
      });

      // The k6 shape: the same characters inside a longer alphanumeric word.
      const buriedInAWord = `Mozilla/5.0 (compatible; x${token}9/1.0)`;
      expect({ list, token, fires: matchesToken(buriedInAWord, token) }).toEqual({
        list,
        token,
        fires: false,
      });
    }
  });
});
