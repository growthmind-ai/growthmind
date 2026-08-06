import { describe, expect, test } from "bun:test";

import * as sessionSourceMessages from "../../src/session-source/messages";
import { FORBIDDEN_PRODUCT_JARGON } from "../../src/signatures/messages";
import { FLOOR_OBSERVATION_TEMPLATES } from "../../src/summary/messages";
import { loadModuleUnderConstruction } from "./module-under-construction";

const ONBOARDING_MESSAGES_MODULE = {
  modulePath: "../../src/onboarding/messages",
  ownedBy: "ADD Wave 1, the onboarding/messages.ts task",
} as const;

const loadOnboardingMessages = (): Promise<Record<string, unknown>> =>
  loadModuleUnderConstruction(ONBOARDING_MESSAGES_MODULE);

function derivedFromExports(namespace: Record<string, unknown>): string[] {
  const derived: string[] = [];

  for (const [name, value] of Object.entries(namespace)) {
    if (name === "ALL_ONBOARDING_MESSAGES") continue;

    if (name === "ONBOARDING_PROPER_NOUNS") continue;

    if (typeof value === "string") {
      derived.push(value);
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const entry of Object.values(value)) {
        if (typeof entry === "string") derived.push(entry);
      }
    }
    // Functions are parameterised, not fixed constants. If Wave 1 ships a
    // message BUILDER here, it must be registered explicitly the way
    // `session-source`'s audit handles `secondSourceRefusalMessage` — and the
    // completeness row below is what fails until it is.
  }

  return derived;
}

async function everyOnboardingMessage(): Promise<string[]> {
  const namespace = await loadOnboardingMessages();
  const registered = namespace.ALL_ONBOARDING_MESSAGES;

  if (!Array.isArray(registered)) {
    throw new Error(
      "NOT IMPLEMENTED YET: onboarding/messages.ts exports no ALL_ONBOARDING_MESSAGES array. " +
        "ADD Wave 1 owns it. Without it this audit has nothing total to walk, and a " +
        "best-effort copy audit is the one that misses the string that ships.",
    );
  }

  return registered.filter((entry): entry is string => typeof entry === "string");
}

// UX §8.2, verbatim: the exported constant and the key components read.
const AGENT_COPY: readonly (readonly [string, string])[] = [
  ["STEP_AGENT_HELPER", "stepAgentHelper"],
  ["AGENT_PICK_PROMPT", "agentPickPrompt"],
  ["AGENT_PRE_MINT_LINE", "agentPreMintLine"],
  ["AGENT_PASTE_INTO_TEMPLATE", "agentPasteIntoTemplate"],
  ["AGENT_RUN_ANYWHERE_LINE", "agentRunAnywhereLine"],
  ["AGENT_MINT_LABEL", "agentMintLabel"],
  ["AGENT_MINT_PENDING", "agentMintPending"],
  ["AGENT_MINT_AGAIN_LABEL", "agentMintAgainLabel"],
  ["AGENT_MINT_FAILED_LINE", "agentMintFailedLine"],
  ["AGENT_KEY_ONCE_NOTICE", "agentKeyOnceNotice"],
  ["AGENT_KEY_LABEL", "agentKeyLabel"],
  ["AGENT_COPY_KEY_LABEL", "agentCopyKeyLabel"],
  ["AGENT_COPY_BLOCK_TEMPLATE", "agentCopyBlockTemplate"],
  ["AGENT_KEY_GONE_NOTICE", "agentKeyGoneNotice"],
  ["AGENT_KEY_HOLE_NOTICE", "agentKeyHoleNotice"],
  ["AGENT_WAITING_LINE", "agentWaitingLine"],
  ["AGENT_WAITING_NEXT", "agentWaitingNext"],
  ["AGENT_CONNECTED_LINE", "agentConnectedLine"],
  ["AGENT_CONNECTED_ORG_LINE", "agentConnectedOrgLine"],
  ["AGENT_EMPTY_IS_FINE_LINE", "agentEmptyIsFineLine"],
  ["AGENT_COPILOT_PROMPTED_NOTE", "agentCopilotPromptedNote"],
  ["AGENT_COPILOT_USER_SCOPE_TEMPLATE", "agentCopilotUserScopeTemplate"],
  ["AGENT_CODEX_ENV_VAR_NOTE", "agentCodexEnvVarNote"],
  ["AGENT_CLAUDE_FILE_DISCLOSURE", "agentClaudeFileDisclosure"],
  ["AGENT_CLAUDE_ENV_VAR_NOTE", "agentClaudeEnvVarNote"],
  ["AGENT_CLAUDE_TYPE_TRAP", "agentClaudeTypeTrap"],
  ["AGENT_CLAUDE_APPROVAL_NOTE", "agentClaudeApprovalNote"],
  ["AGENT_REVOKE_LABEL", "agentRevokeLabel"],
  ["AGENT_REVOKE_CONSEQUENCE", "agentRevokeConsequence"],
  ["AGENT_REVOKE_CONFIRM_LABEL", "agentRevokeConfirmLabel"],
  ["AGENT_REVOKE_CANCEL_LABEL", "agentRevokeCancelLabel"],
  ["AGENT_REVOKED_LINE", "agentRevokedLine"],
  ["AGENT_REVOKE_FAILED_LINE", "agentRevokeFailedLine"],
  ["AGENT_MINTED_ANNOUNCEMENT", "agentMintedAnnouncement"],
  ["AGENT_KEY_COPIED_ANNOUNCEMENT", "agentKeyCopiedAnnouncement"],
  ["AGENT_BLOCK_COPIED_ANNOUNCEMENT", "agentBlockCopiedAnnouncement"],
];

const RETIRED_AGENT_STUB_LINE =
  "When this is built, your coding agent will be able to ask Growthmind what is open and pull a fix to work on.";

// Every one of these is a typed part of a config block. A copy string carrying one
// is a second home for a vendor literal, and the two drift.
const VENDOR_LITERALS = [
  "GROWTHMIND_API_KEY",
  "MCP: Open User Configuration",
  "mcp.json",
  "config.toml",
  "mcpServers",
  "serverUrl",
  "bearer_token_env_var",
  "${input:",
  "YOUR_KEY_HERE",
  "VS Code",
  ".vscode",
  ".cursor",
  ".codeium",
  "Authorization",
] as const;

function messageTable(namespace: Record<string, unknown>): Record<string, unknown> {
  const table = namespace.ONBOARDING_MESSAGES;
  if (typeof table !== "object" || table === null || Array.isArray(table)) {
    throw new Error(
      "NOT IMPLEMENTED YET: onboarding/messages.ts exports no ONBOARDING_MESSAGES object. " +
        "Components read their copy through it, so a constant with no key here is a string " +
        "no surface can render.",
    );
  }
  return table as Record<string, unknown>;
}

function agentStrings(namespace: Record<string, unknown>): string[] {
  return AGENT_COPY.map(([name]) => namespace[name]).filter(
    (value): value is string => typeof value === "string",
  );
}

const DURATION = /\d+\s*(s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b/i;

const HEDGE = /\babout\b|\busually\b|\btypically\b|\bapprox|~/i;

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
  "report",
  "ingest",
  "pipeline",
  "surface",
  "signature",
  "SDK",
  "MCP",
  "org",
  "org-scoped",
] as const;

const BARE_STATUS = /\b[1-5]\d{2}\b/;
const LIVE_CLAIM = /\blive\b/i;
// "Coming soon" left this ban with AD-7.2: it is now the sanctioned badge copy.
const APOLOGETIC = /\bsorry\b|\bunfortunately\b|!/i;

const maskInterpolations = (message: string): string =>
  message
    .replace(/\{[^}]*\}/g, "{token}")
    .split("12345")
    .join("{sample-project-number}")
    .split("C01AB2CD3EF")
    .join("{sample-channel-id}");

const PROPER_NOUN_SHAPED = /\b[A-Z][a-z]+\b/g;

const SENTENCE_BOUNDARY = /[.?!:;—·→|([\]"']$/;

function properNounOffenders(message: string, allowed: ReadonlySet<string>): string[] {
  const offenders: string[] = [];

  for (const match of message.matchAll(PROPER_NOUN_SHAPED)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (allowed.has(token)) continue;

    const before = message.slice(0, index).trimEnd();
    if (before.length === 0) continue;
    if (SENTENCE_BOUNDARY.test(before)) continue;

    offenders.push(`${token} in: ${message}`);
  }

  return offenders;
}

describe("the onboarding copy audit — AD-4, FR-O22", () => {
  test("every onboarding string has one home in shared", async () => {
    const namespace = await loadOnboardingMessages();
    const derived = derivedFromExports(namespace);
    const registered = new Set(await everyOnboardingMessage());

    const missing = derived.filter((message) => !registered.has(message));
    expect(missing).toEqual([]);
    expect(registered.size).toBeGreaterThan(0);
  });

  test("the five interest strings are exported constants registered in the audit", async () => {
    const namespace = await loadOnboardingMessages();
    const registered = new Set(await everyOnboardingMessage());

    const expected = [
      "PROVIDER_SOON_BADGE",
      "INTEREST_PING_LABEL",
      "INTEREST_PENDING_LABEL",
      "INTEREST_NOTED_BADGE",
      "INTEREST_NOTED_TEMPLATE",
    ] as const;

    const missingExports = expected.filter((name) => typeof namespace[name] !== "string");
    expect(missingExports).toEqual([]);

    const unregistered = expected.filter((name) => !registered.has(namespace[name] as string));
    expect(unregistered).toEqual([]);
  });

  test("no user-facing string commits to a duration", async () => {
    const messages = await everyOnboardingMessage();

    expect("Events usually arrive within 85 seconds.").toMatch(DURATION);
    expect("This usually takes about half a minute.").toMatch(HEDGE);

    expect("Watching for what you just did.").not.toMatch(DURATION);

    const durationOffenders = messages.filter((message) => DURATION.test(message));
    const hedgeOffenders = messages.filter((message) => HEDGE.test(message));

    expect(durationOffenders).toEqual([]);
    expect(hedgeOffenders).toEqual([]);
  });

  test("no onboarding string contains product jargon", async () => {
    const messages = await everyOnboardingMessage();

    expect(FORBIDDEN_PRODUCT_JARGON.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const message of messages) {
      for (const token of FORBIDDEN_PRODUCT_JARGON) {
        if (new RegExp(`\\b${token}\\b`, "i").test(message)) {
          offenders.push(`${token} in: ${message}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no onboarding string contains engineering jargon", async () => {
    const messages = await everyOnboardingMessage();

    const offenders: string[] = [];
    for (const message of messages) {
      for (const token of ENGINEERING_JARGON) {
        if (new RegExp(`\\b${token}\\b`, "i").test(message)) {
          offenders.push(`${token} in: ${message}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no onboarding string contains the words the UX bans", async () => {
    const messages = await everyOnboardingMessage();

    expect(/\bsurface\b/i.test("We will show what we found on the surface.")).toBe(true);
    expect(/\bsurface\b/i.test("The same thing is now in your channel.")).toBe(false);

    const offenders: string[] = [];
    for (const message of messages) {
      for (const token of UX_BANNED_WORDS) {
        if (new RegExp(`\\b${token}\\b`, "i").test(message)) {
          offenders.push(`${token} in: ${message}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no onboarding string contains a bare HTTP status or an error code", async () => {
    const messages = await everyOnboardingMessage();

    const statusLikePlaceholder = "Project number, for example 404.";
    expect(BARE_STATUS.test(statusLikePlaceholder)).toBe(true);
    expect(BARE_STATUS.test(statusLikePlaceholder.split("404").join("{token}"))).toBe(false);

    const offenders = messages
      .map(maskInterpolations)
      .filter((message) => BARE_STATUS.test(message));

    expect(offenders).toEqual([]);

    const MACHINE_IDENTIFIER = /\b[a-z]+_[a-z_]+\b/;
    expect(MACHINE_IDENTIFIER.test("That failed with invalid_credentials.")).toBe(true);
    expect(MACHINE_IDENTIFIER.test("That key did not work.")).toBe(false);

    const identifierOffenders = messages.filter((message) => MACHINE_IDENTIFIER.test(message));
    expect(identifierOffenders).toEqual([]);
  });

  test("no onboarding string claims freshness with the word live", async () => {
    const messages = await everyOnboardingMessage();

    const offenders = messages.filter((message) => LIVE_CLAIM.test(message));
    expect(offenders).toEqual([]);
  });

  test("the proper-noun allow-list is exactly the eleven connection names", async () => {
    const namespace = await loadOnboardingMessages();
    const allowList = namespace.ONBOARDING_PROPER_NOUNS;

    expect(allowList).toEqual([
      "PostHog",
      "Slack",
      "GitHub",
      "GitLab",
      "Claude Code",
      "Cursor",
      "Copilot",
      "Codex",
      "Windsurf",
      "Amplitude",
      "Mixpanel",
    ]);
  });

  test("every capitalised proper noun in every onboarding string is in the allow-list", async () => {
    const namespace = await loadOnboardingMessages();
    const messages = await everyOnboardingMessage();
    const allowList = Array.isArray(namespace.ONBOARDING_PROPER_NOUNS)
      ? namespace.ONBOARDING_PROPER_NOUNS.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];

    const allowed = new Set([...allowList, "Growthmind"]);

    // The planted offender must sit OUTSIDE the allow-list: Mixpanel played this
    // role until AD-7.2 sanctioned it, which would have made the control dead.
    expect(
      properNounOffenders("Paste the key you use for Datadog here.", allowed).length,
    ).toBeGreaterThan(0);

    expect(properNounOffenders("We read sessions from your PostHog project.", allowed)).toEqual([]);
    expect(properNounOffenders("In Slack: right-click → View channel details.", allowed)).toEqual(
      [],
    );

    const offenders = messages.flatMap((message) => properNounOffenders(message, allowed));
    expect(offenders).toEqual([]);
  });

  test("the session-source vendor ban still passes", async () => {
    const everyPortMessage = [
      ...sessionSourceMessages.ALL_CUSTOMER_FACING_MESSAGES,
      sessionSourceMessages.secondSourceRefusalMessage({
        host: "analytics.example.invalid",
        sourceProjectId: "s0-source-project",
      }),
      sessionSourceMessages.expectedLagStatement({ typicalSeconds: 85, worstCaseSeconds: 280 }),
    ];

    const offenders = everyPortMessage.filter((message) => /posthog/i.test(message));
    expect(offenders).toEqual([]);
  });

  test("no onboarding string is apologetic", async () => {
    const messages = await everyOnboardingMessage();

    expect("Sorry, this one is late.").toMatch(APOLOGETIC);
    expect("Unfortunately, not yet.").toMatch(APOLOGETIC);
    expect("It landed!").toMatch(APOLOGETIC);
    expect("Coming soon.").not.toMatch(APOLOGETIC);

    const offenders = messages.filter((message) => APOLOGETIC.test(message));
    expect(offenders).toEqual([]);
  });
});

describe("rulings settled by the copy wave", () => {
  test("the two stage headings are the stopped forms, verbatim", async () => {
    const messages = new Set(await everyOnboardingMessage());

    expect(messages.has("Watching for what you just did.")).toBe(true);
    expect(messages.has("Reading what came back.")).toBe(true);

    expect(messages.has("Watching for what you just did")).toBe(false);
    expect(messages.has("Reading what came back")).toBe(false);
  });

  test("the agent step title is the coding-assistant form, verbatim", async () => {
    const namespace = await loadOnboardingMessages();

    expect(namespace.STEP_AGENT_TITLE).toBe("Connect your coding assistant");
  });

  test("the filler line is retired: neither filler constant is exported or registered", async () => {
    const namespace = await loadOnboardingMessages();
    const registered = await everyOnboardingMessage();

    expect(Object.keys(namespace)).not.toContain("STEP_REPO_FILLER");
    expect(Object.keys(namespace)).not.toContain("STEP_AGENT_FILLER");

    for (const retired of [
      "Not built yet. It arrives with the fix-spec work.",
      "Not built yet. It arrives with the agent-protocol work.",
    ]) {
      expect(registered).not.toContain(retired);
    }
  });

  test("no onboarding string carries a machine class identifier, and no second class table is authored here", async () => {
    const namespace = await loadOnboardingMessages();
    const messages = await everyOnboardingMessage();

    expect(Object.keys(FLOOR_OBSERVATION_TEMPLATES).toSorted()).toEqual(
      ["broken", "changed_mind", "confusing", "instrumentation"].toSorted(),
    );

    const CLASS_IDENTIFIER = /\bchanged_mind\b|\bsomething_is_not_working\b/i;
    expect(CLASS_IDENTIFIER.test("something_is_not_working")).toBe(true);
    expect(CLASS_IDENTIFIER.test("Saving your workspace settings is not working.")).toBe(false);

    const offenders = messages.filter((message) => CLASS_IDENTIFIER.test(message));
    expect(offenders).toEqual([]);

    const classKeys = new Set(Object.keys(FLOOR_OBSERVATION_TEMPLATES));
    const secondTables: string[] = [];
    for (const [name, value] of Object.entries(namespace)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const overlap = Object.keys(value).filter((key) => classKeys.has(key));
      if (overlap.length > 0) secondTables.push(`${name} re-keys ${overlap.join(", ")}`);
    }
    expect(secondTables).toEqual([]);
  });
});

describe("the coding-assistant panel's copy — O-026, UX §8.2, §8.3", () => {
  test("every string the panel renders is an exported constant in the audit", async () => {
    const namespace = await loadOnboardingMessages();
    const registered = new Set(await everyOnboardingMessage());

    const missingExports = AGENT_COPY.filter(([name]) => typeof namespace[name] !== "string").map(
      ([name]) => name,
    );
    expect(missingExports).toEqual([]);

    const unregistered = AGENT_COPY.filter(
      ([name]) => !registered.has(namespace[name] as string),
    ).map(([name]) => name);
    expect(unregistered).toEqual([]);
  });

  test("every panel string has the key the components read it by", async () => {
    const namespace = await loadOnboardingMessages();
    const table = messageTable(namespace);

    const missingKeys = AGENT_COPY.filter(
      ([name, key]) => typeof table[key] !== "string" || table[key] !== namespace[name],
    ).map(([, key]) => key);
    expect(missingKeys).toEqual([]);
  });

  test("the block copy control's accessible label has a registered home", async () => {
    const namespace = await loadOnboardingMessages();
    const registered = new Set(await everyOnboardingMessage());

    expect(typeof namespace.SLACK_COPY_INVITE_LABEL).toBe("string");
    expect(registered.has(namespace.SLACK_COPY_INVITE_LABEL as string)).toBe(true);
  });

  test("the stub sentence the panel replaces is retired, not left registered", async () => {
    const namespace = await loadOnboardingMessages();
    const registered = await everyOnboardingMessage();
    const table = messageTable(namespace);

    expect(Object.keys(namespace)).not.toContain("STEP_AGENT_WHAT_IT_WILL_DO");
    expect(Object.keys(table)).not.toContain("stepAgentWhatItWillDo");
    expect(registered).not.toContain(RETIRED_AGENT_STUB_LINE);
  });

  test("the panel's copy introduces no new proper noun", async () => {
    const namespace = await loadOnboardingMessages();
    const allowList = Array.isArray(namespace.ONBOARDING_PROPER_NOUNS)
      ? namespace.ONBOARDING_PROPER_NOUNS.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];

    expect(allowList).toHaveLength(11);
    expect(allowList).not.toContain("VS Code");

    const strings = agentStrings(namespace);
    expect(strings).toHaveLength(AGENT_COPY.length);

    const allowed = new Set([...allowList, "Growthmind"]);
    const offenders = strings.flatMap((message) => properNounOffenders(message, allowed));
    expect(offenders).toEqual([]);
  });

  test("every vendor literal lives in the block, never in the prose", async () => {
    const namespace = await loadOnboardingMessages();

    const planted = "Paste this into ~/.cursor/mcp.json and set GROWTHMIND_API_KEY.";
    expect(VENDOR_LITERALS.filter((literal) => planted.includes(literal)).length).toBeGreaterThan(
      0,
    );

    const strings = agentStrings(namespace);
    expect(strings).toHaveLength(AGENT_COPY.length);

    const offenders = strings.flatMap((message) =>
      VENDOR_LITERALS.filter((literal) => message.includes(literal)).map(
        (literal) => `${literal} in: ${message}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the FindingCard dismiss control's copy — O-019, ADD Decision 2 / UX spec", () => {
  test(`carries the five new FindingCard dismiss copy strings, none using "permanent" or "org-wide"`, async () => {
    const namespace = await loadOnboardingMessages();
    const registered = new Set(await everyOnboardingMessage());

    // Wave 1 task 1.3 owns these five exports (packages/shared/src/onboarding/messages.ts),
    // per .ai/ux/o-019-dismissal-wired.md's decided Variant 1 copy: idle label, pending label,
    // the always-visible caption, the FR-9 confirmed line, and the error line.
    const expected = [
      "FINDING_DISMISS_LABEL",
      "FINDING_DISMISS_PENDING_LABEL",
      "FINDING_DISMISS_CAPTION",
      "FINDING_DISMISS_CONFIRMED_LINE",
      "FINDING_DISMISS_ERROR_LINE",
    ] as const;

    const missingExports = expected.filter((name) => typeof namespace[name] !== "string");
    expect(missingExports).toEqual([]);

    const unregistered = expected.filter((name) => {
      const value = namespace[name];
      return typeof value !== "string" || !registered.has(value);
    });
    expect(unregistered).toEqual([]);

    for (const name of expected) {
      const value = namespace[name];
      if (typeof value !== "string") continue;

      expect(value.trim().length).toBeGreaterThan(0);

      const lower = value.toLowerCase();
      expect(lower.includes("permanent")).toBe(false);
      expect(lower.includes("org-wide")).toBe(false);
    }
  });
});
