// THE ONBOARDING COPY AUDIT — AD-4, FR-O22. ADD §9, 11 rows, plus the two
// RULING ROWS Wave 0b handed forward (marked below).
//
// ###########################################################################
// # WHY THIS MODULE EXISTS AT ALL, AND WHY IT IS NOT SPREAD INTO THE ONE
// # NEXT DOOR.
// #
// # `packages/shared/src/session-source/messages.ts` is audited so the
// # VENDOR'S NAME NEVER APPEARS. That ban is correct and it stays: the
// # pipeline behind the `SessionSource` port does not learn the vendor's
// # name, so a second source needs no copy rewrite.
// #
// # It is also FATAL for a step whose entire job is "In PostHog: Settings ->
// # Personal API keys." "Get a key from your analytics provider" is not an
// # instruction anybody can follow. So the onboarding strings get their own
// # home with its own audit and a TWO-NAME allow-list, and this suite pins
// # BOTH SIDES: the allow-list is exactly PostHog and Slack, AND the old
// # module's vendor ban still passes — re-run from inside this file, so
// # nobody "fixes" a failure over there by copying this exception across.
// ###########################################################################
//
// R-LATENCY'S ENFORCEMENT POINT IS ROW 2 BELOW. The internal design target of
// ~25-35 s sizes the build and the acceptance run; it appears in NO rendered
// string, ever. No countdown, no "about 30 seconds", no progress bar implying
// a known duration. `describeExpectedLag` computes `pollIntervalSeconds + 25`
// and `+ 220` — with the shipped column default of 60 that is the sentence
// "85 seconds... 280 seconds" in front of a customer. AD-3 makes it
// structurally unrenderable on the counter; this row makes it unwritable here.
//
// MODELLED ON `packages/shared/__tests__/session-source/messages.test.ts` and
// inheriting every check it makes, with exactly one difference — the
// proper-noun allow-list.

import { describe, expect, test } from "bun:test";

import * as sessionSourceMessages from "../../src/session-source/messages";
import { FORBIDDEN_PRODUCT_JARGON } from "../../src/signatures/messages";
import { FLOOR_OBSERVATION_TEMPLATES } from "../../src/summary/messages";
import { loadModuleUnderConstruction } from "./module-under-construction";

/** ADD Wave 1 creates `packages/shared/src/onboarding/messages.ts`. */
const ONBOARDING_MESSAGES_MODULE = {
  modulePath: "../../src/onboarding/messages",
  ownedBy: "ADD Wave 1, the onboarding/messages.ts task",
} as const;

const loadOnboardingMessages = (): Promise<Record<string, unknown>> =>
  loadModuleUnderConstruction(ONBOARDING_MESSAGES_MODULE);

// --- derivations over the module -------------------------------------------

/**
 * Every fixed string the module exports, derived from its ACTUAL exports.
 *
 * CR-10's lesson, inherited verbatim: comparing two hand-maintained lists
 * against each other lets a string added to NEITHER escape every audit
 * silently. The expected set is derived from `Object.entries(module)`, so a
 * new constant is picked up the moment it is exported, with nothing to
 * remember to copy anywhere.
 */
function derivedFromExports(namespace: Record<string, unknown>): string[] {
  const derived: string[] = [];

  for (const [name, value] of Object.entries(namespace)) {
    // The derivation target is not part of its own input.
    if (name === "ALL_ONBOARDING_MESSAGES") continue;
    // The allow-list is a list of NAMES, not of customer-facing sentences.
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

/** The registered aggregate — what every scan below walks. */
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

// --- the bans, as regexes ---------------------------------------------------

/** A committed duration. The ADD names this pattern directly (§9). */
const DURATION = /\d+\s*(s|secs?|seconds?|m|mins?|minutes?|h|hours?)\b/i;
/** A duration promised without printing one. */
const HEDGE = /\babout\b|\busually\b|\btypically\b|\bapprox|~/i;

/** The `session-source` engineering-jargon list, inherited unchanged. */
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

/**
 * The words the UX spec bans by name (§1 Vocabulary, replayed as Checklist
 * row 32). Product decisions §10: never make the customer learn our
 * vocabulary. The thing we show them is WHAT WE FOUND, not "a finding".
 */
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
const APOLOGETIC = /\bsorry\b|\bunfortunately\b|\bcoming soon\b|!/i;

/**
 * Mask the interpolation tokens and the two literal placeholders before the
 * bare-status scan.
 *
 * The masking is proved load-bearing by its own control below, exactly as
 * `session-source/messages.test.ts` proves its project-id mask — an unmasked
 * scan would fail on a customer's own PostHog project number rather than on
 * an actual leak, and a mask that silently matched nothing would make the
 * whole row vacuous.
 */
const maskInterpolations = (message: string): string =>
  message
    .replace(/\{[^}]*\}/g, "{token}")
    .split("12345")
    .join("{sample-project-number}")
    .split("C01AB2CD3EF")
    .join("{sample-channel-id}");

/**
 * A proper-noun-shaped token: MIXED CASE, capital first.
 *
 * All-caps acronyms are deliberately out of scope here — `SDK` and `MCP` are
 * already banned by row 5's list, and `EU`, `ID` and `API` all appear in the
 * UX spec's own normative copy ("Using the EU region", "Channel ID", "Your
 * personal API key"). Scanning them here would fail the audit on the spec.
 */
const PROPER_NOUN_SHAPED = /\b[A-Z][a-z]+\b/g;

/**
 * Characters after which a capital is just a sentence starting, not a name.
 *
 * The colon and the arrow are in the list because the two normative helper
 * sentences walk a vendor's own UI: "In PostHog: Settings -> Personal API
 * keys" and "In Slack: right-click the channel -> View channel details". The
 * capitals there are the vendor's labels, not third vendors.
 */
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
  // ---------------------------------------------------------------- §9 row 1
  test("every onboarding string has one home in shared", async () => {
    const namespace = await loadOnboardingMessages();
    const derived = derivedFromExports(namespace);
    const registered = new Set(await everyOnboardingMessage());

    // A constant exported from the module but not registered in the aggregate
    // escapes every scan below — silently, and forever. This is the row that
    // makes the audit TOTAL instead of best-effort.
    const missing = derived.filter((message) => !registered.has(message));
    expect(missing).toEqual([]);
    expect(registered.size).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------- §9 row 2
  // FR-O22, AC-O37. R-LATENCY'S ENFORCEMENT POINT.
  test("no user-facing string commits to a duration", async () => {
    const messages = await everyOnboardingMessage();

    // POSITIVE CONTROL. The two sentences this rule was written against: the
    // one `describeExpectedLag` would produce, and the one the public
    // get-started page still promises today (AD-21 removes it this sprint).
    expect("Events usually arrive within 85 seconds.").toMatch(DURATION);
    expect("This usually takes about half a minute.").toMatch(HEDGE);
    // NEGATIVE CONTROL: elapsed, which is the ONE time value this surface may
    // carry, is a NUMBER on the view — never authored copy. No fixed string
    // needs a duration in it, so a clean fixture must stay clean.
    expect("Watching for what you just did.").not.toMatch(DURATION);

    const durationOffenders = messages.filter((message) => DURATION.test(message));
    const hedgeOffenders = messages.filter((message) => HEDGE.test(message));

    expect(durationOffenders).toEqual([]);
    expect(hedgeOffenders).toEqual([]);
  });

  // ---------------------------------------------------------------- §9 row 3
  test("no onboarding string contains product jargon", async () => {
    const messages = await everyOnboardingMessage();

    // ONE VOCABULARY, NOT TWO. The list is IMPORTED from `signatures/messages`
    // rather than restated — the discipline `delivery/messages.test.ts`
    // already keeps. A second copy diverges the first time somebody adds a
    // word to one of them.
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

  // ---------------------------------------------------------------- §9 row 4
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

  // ---------------------------------------------------------------- §9 row 5
  // UX Checklist row 32.
  test("no onboarding string contains the words the UX bans", async () => {
    const messages = await everyOnboardingMessage();

    // POSITIVE CONTROL — the scan catches a banned word in a plausible
    // sentence, so an empty offender list below means something. NEGATIVE
    // CONTROL — a sentence made of the words the surface actually uses does
    // not trip it, so the row is a ban on our vocabulary and not on English.
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

  // ---------------------------------------------------------------- §9 row 6
  test("no onboarding string contains a bare HTTP status or an error code", async () => {
    const messages = await everyOnboardingMessage();

    // The masking is load-bearing, and this proves it: the sample project
    // number a founder might genuinely have is `404`, and an unmasked scan
    // would fail the audit on their own id rather than on a leak.
    const statusLikePlaceholder = "Project number, for example 404.";
    expect(BARE_STATUS.test(statusLikePlaceholder)).toBe(true);
    expect(BARE_STATUS.test(statusLikePlaceholder.split("404").join("{token}"))).toBe(false);

    const offenders = messages
      .map(maskInterpolations)
      .filter((message) => BARE_STATUS.test(message));

    expect(offenders).toEqual([]);

    // And no machine error code in any encoding either — the refusal codes,
    // the failure codes and the outcome members are identifiers, not English.
    // A snake_case token on this screen is a developer's word that escaped.
    const MACHINE_IDENTIFIER = /\b[a-z]+_[a-z_]+\b/;
    expect(MACHINE_IDENTIFIER.test("That failed with invalid_credentials.")).toBe(true);
    expect(MACHINE_IDENTIFIER.test("That key did not work.")).toBe(false);

    const identifierOffenders = messages.filter((message) => MACHINE_IDENTIFIER.test(message));
    expect(identifierOffenders).toEqual([]);
  });

  // ---------------------------------------------------------------- §9 row 7
  test("no onboarding string claims freshness with the word live", async () => {
    const messages = await everyOnboardingMessage();

    // Inherited from `session-source`: PostHog stores the time the customer's
    // own browser declared and exposes no arrival time by any route, so an
    // event can land behind everything we have already read. "Live" is a claim
    // the pipeline cannot back, and on THIS surface it would be read as a
    // promise about the wait.
    const offenders = messages.filter((message) => LIVE_CLAIM.test(message));
    expect(offenders).toEqual([]);
  });

  // ---------------------------------------------------------------- §9 row 8
  test("the proper-noun allow-list is exactly PostHog and Slack", async () => {
    const namespace = await loadOnboardingMessages();
    const allowList = namespace.ONBOARDING_PROPER_NOUNS;

    // AD-4. ENUMERATED EXACTLY, and exactly two. A third name added here is a
    // product decision about what this surface talks about, and it should cost
    // somebody an edit to a list with a comment on it explaining why the list
    // exists — not a quiet mention inside a sentence.
    expect(allowList).toEqual(["PostHog", "Slack"]);
  });

  // ---------------------------------------------------------------- §9 row 9
  test("every capitalised proper noun in every onboarding string is in the allow-list", async () => {
    const namespace = await loadOnboardingMessages();
    const messages = await everyOnboardingMessage();
    const allowList = Array.isArray(namespace.ONBOARDING_PROPER_NOUNS)
      ? namespace.ONBOARDING_PROPER_NOUNS.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];

    // Our own name is not a "vendor this surface may name" — it is the first
    // person. UX rows 1 and 3 both put it in normative copy ("Set up
    // Growthmind", "Growthmind will read your code"), so it is allowed here
    // and deliberately NOT added to `ONBOARDING_PROPER_NOUNS`, which is about
    // third parties.
    const allowed = new Set([...allowList, "Growthmind"]);

    // POSITIVE CONTROL. A third vendor slipping into a helper sentence is the
    // exact leak this row exists to catch, and it must not be sentence-initial
    // in the fixture or the control would prove nothing about the scan's
    // boundary handling.
    expect(
      properNounOffenders("Paste the key you use for Mixpanel here.", allowed).length,
    ).toBeGreaterThan(0);
    // NEGATIVE CONTROLS: the two allowed names mid-sentence, and a capital
    // that is only a sentence starting after a vendor's UI arrow.
    expect(properNounOffenders("We read sessions from your PostHog project.", allowed)).toEqual([]);
    expect(properNounOffenders("In Slack: right-click → View channel details.", allowed)).toEqual(
      [],
    );

    const offenders = messages.flatMap((message) => properNounOffenders(message, allowed));
    expect(offenders).toEqual([]);
  });

  // --------------------------------------------------------------- §9 row 10
  test("the session-source vendor ban still passes", async () => {
    // A PINNING ASSERTION, RE-RUN FROM INSIDE THIS SUITE.
    //
    // The failure mode it exists for: somebody adds a PostHog instruction to
    // `session-source/messages.ts`, watches that module's own audit go red,
    // sees this file's allow-list, and "fixes" it by copying the exception
    // across. That would delete the reason the port is vendor-neutral —
    // the pipeline behind it does not learn the vendor's name, so a second
    // source needs no copy rewrite — for the sake of one step's helper text.
    //
    // The exception belongs HERE and nowhere else, and this row is what says
    // so from inside the file that holds it.
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

  // --------------------------------------------------------------- §9 row 11
  // UX Checklist row 4 — read it aloud to someone non-technical.
  test("no stub string is apologetic", async () => {
    const messages = await everyOnboardingMessage();

    // "Not built yet. It arrives with the fix-spec work." is honest. "Sorry,
    // this isn't ready yet!" is a product apologising for itself, and a
    // founder reads an apology as a warning. Applied to EVERY onboarding
    // string rather than only the two stub sentences: this module is the only
    // scope reachable from here, the rule is right everywhere on this surface,
    // and no normative string in the UX spec contains an exclamation mark.
    expect("Sorry, this one is coming soon!").toMatch(APOLOGETIC);
    expect("Not built yet. It arrives with the fix-spec work.").not.toMatch(APOLOGETIC);

    const offenders = messages.filter((message) => APOLOGETIC.test(message));
    expect(offenders).toEqual([]);
  });
});

// ===========================================================================
// THE TWO RULINGS WAVE 0b HANDED FORWARD. Both are copy questions, both were
// left open with a note that "the copy wave should pin it", and both are P0 if
// they land wrong. A ruling with no test is not settled, so each gets a row.
// ===========================================================================

describe("rulings settled by the copy wave", () => {
  // RULING 1 — HEADING PUNCTUATION.
  //
  // The UX spec renders the two stage headings three ways: with a full stop in
  // Checklist rows 18 and 19, without one in the Flow A sketch (:77,:79), the
  // phase-B ASCII mock (:301) and the states table (:354-355). Wave 0b
  // asserted CONTAINMENT rather than equality and flagged it here.
  //
  // RULING: THE FULL STOP IS IN. The Checklist is the only place the spec
  // marks copy as NORMATIVE ("Copy in bold is normative — ship it verbatim or
  // escalate to me"), and it is the artefact `integration-tester` replays
  // row-by-row as PR gate 4. The sketch, the mock and the states table are
  // descriptions of the design, not the copy contract. Both headings are full
  // sentences and every other sentence on this surface is stopped; an
  // unstopped one would be the odd one out, not a style.
  //
  // This row and Wave 0b's containment row agree — pinning equality here
  // completes that one rather than competing with it.
  test("the two stage headings are the stopped forms, verbatim", async () => {
    const messages = new Set(await everyOnboardingMessage());

    expect(messages.has("Watching for what you just did.")).toBe(true);
    expect(messages.has("Reading what came back.")).toBe(true);

    // And the unstopped variants are NOT also registered. Two spellings of one
    // heading in the copy home is the drift the one-home rule exists to stop,
    // and it would render differently depending on which constant a component
    // reached for.
    expect(messages.has("Watching for what you just did")).toBe(false);
    expect(messages.has("Reading what came back")).toBe(false);
  });

  // RULING 2 — `finalClass` TO PLAIN ENGLISH.
  //
  // Wave 0b flagged that no mapping table exists and that a leaked
  // `something_is_not_working` in front of a customer is a P0.
  //
  // RULING: NO NEW TABLE IS WRITTEN, BECAUSE ONE ALREADY SHIPS.
  // `FLOOR_OBSERVATION_TEMPLATES` (`packages/shared/src/summary/messages.ts:216`)
  // is exactly that map — `Record<FindingClass, string>` over the four real
  // classes, each row carrying a comment naming the proof that licensed its
  // sentence. It is already inside `ALL_CUSTOMER_FACING_MESSAGES` and already
  // audited. A second table in `onboarding/messages.ts` would be the D11
  // duplication AD-4 spends a whole decision avoiding, and the two would
  // disagree the first time a threshold moved.
  //
  // A CORRECTION THAT COMES WITH THE RULING: there is no class called
  // `something_is_not_working`. `findingClassSchema`
  // (`packages/core/src/rules/types.ts:16-21`) has FOUR members — `broken`,
  // `confusing`, `changed_mind`, `instrumentation`. The UX mock's
  // "SOMETHING IS NOT WORKING" chip is a RENDERING of `broken`, not a stored
  // value, and Wave 0b's `stage-view.test.ts` fixture uses the mock's string
  // as if it were one. That is harmless where it sits (the fixture is only
  // walked for banned tokens) and it is exactly the confusion this row exists
  // to stop from reaching production.
  //
  // WHAT IS STILL OPEN AND IS NOT MINE: `OnboardingFinding.finalClass` is
  // typed `string` in the Wave 0 mirror, so nothing stops `finding-view.ts`
  // passing it straight through to `classSentence`. That belongs to the wave
  // that writes `finding-view.ts`, and §9's finding-view block has no row for
  // it — flagged to the PL rather than smuggled in here, because this file
  // does not own that module.
  test("no onboarding string carries a machine class identifier, and no second class table is authored here", async () => {
    const namespace = await loadOnboardingMessages();
    const messages = await everyOnboardingMessage();

    // The shipped map is the home, and it covers all four classes.
    expect(Object.keys(FLOOR_OBSERVATION_TEMPLATES).toSorted()).toEqual(
      ["broken", "changed_mind", "confusing", "instrumentation"].toSorted(),
    );

    // The scan is deliberately NARROW: only the identifier spellings. Three of
    // the four class names — `broken`, `confusing`, `instrumentation` — are
    // also ordinary English, and banning those words from a screen that has to
    // talk about things not working would be a rule about English, not about
    // leaking identifiers. What must never appear is the snake_case spelling
    // (row 6 above bans that class generally) and the mock's fabricated one.
    const CLASS_IDENTIFIER = /\bchanged_mind\b|\bsomething_is_not_working\b/i;
    expect(CLASS_IDENTIFIER.test("something_is_not_working")).toBe(true);
    expect(CLASS_IDENTIFIER.test("Saving your workspace settings is not working.")).toBe(false);

    const offenders = messages.filter((message) => CLASS_IDENTIFIER.test(message));
    expect(offenders).toEqual([]);

    // And no export of this module is a second `Record<FindingClass, string>`.
    // A table here keyed by the same four names is the fork; there is one home
    // and it is `FLOOR_OBSERVATION_TEMPLATES`.
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
