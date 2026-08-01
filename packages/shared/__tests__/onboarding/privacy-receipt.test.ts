// THE PRIVACY RECEIPT — AD-2, FR-O8, PRD ruling R2. ADD §9, 5 rows.
//
// ###########################################################################
// # R2, AND WHY THIS IS A RECEIPT AND NOT A SETTINGS PANEL.
// #
// # `docs/mvp.md` §5 asked step 2's second confirmation to be "masking config
// # verified". There is no masking config to verify: `packages/sdk-js` is a
// # 19-line stub whose own comment says "Nothing is implemented yet", capture
// # is PostHog's, and no masking field exists anywhere in
// # `packages/db/src/schema/`. A confirmation that verifies nothing is a lie
// # shipped to a customer at the exact moment they asked "are you sending my
// # users' personal data anywhere?".
// #
// # So R2 reframes it as a READ-ONLY POSTURE RECEIPT over what is actually
// # shipped and provable. That satisfies §5's real requirement — "must not put
// # PII in the stream, AND MUST BE ABLE TO PROVE IT" — without claiming a
// # capability this tree does not have.
// #
// # READ-ONLY IS THE ASSERTION, and it is carried BY TYPE: `ReceiptLine` is a
// # string alias, so there is no property a field, a toggle, an action or a
// # default value could hang off. A later edit that wants a control has to
// # change the alias first, in the open. That is the same technique AD-19 uses
// # on the `coming-next` arm, applied to the same class of quiet regression.
// ###########################################################################
//
// R2's seven lines and what backs each (PRD `tasks/onboarding-five-steps/prd.md:281-289`):
//   1. URL paths stored normalised and versioned, never raw   — url-path.ts:27
//   2. Internal traffic set aside, inferred from the creator's email domain
//                                                             — internal-domain.ts:57-68
//   3. Bots, headless browsers and coding agents set aside    — exclusions/types.ts:15-23
//   4. THE FAIL DIRECTION IS DECLARED                         — internal-domain.ts:57-68
//   5. Identity stored as a keyed one-way hash, never raw     — sessions.ts:54-64
//   6. No bag of event properties is kept at all              — events.ts:25-35,87
//   7. Every outbound message is scanned for leftover personal data
//                                                             — residual-pii.ts:142-210
//
// PRE-CHECK F2, SETTLED: the ADD's 32-row checklist table calls row 11's test
// `the receipt renders no editable control`; ADD §9 calls it `the receipt
// EXPOSES no editable control`. §9's name wins. ONE test, not two.
//
// A NOTE ON HOW ORDER IS PROVED. §9 asks for "count AND order". The seven
// sentences are not pinned verbatim anywhere — UX row 11 says only "each one
// plain sentence" — so asserting order by matching seven authored strings
// would pin copy no source has written and would break on the first honest
// wording change. Order is proved instead by SUBSTITUTION STABILITY: §9's own
// word for the no-domain case is that the fail-direction sentence is
// "substituted FOR the domain line", so flipping the input must change exactly
// one line, at the same index, leaving the other six byte-identical. That is a
// stronger statement about position than any regex over prose, and it cannot
// be satisfied by a receipt that reorders itself.

import { describe, expect, test } from "bun:test";

import type { BuildPrivacyReceipt, PrivacyReceiptInput, ReceiptLine } from "./contract-shapes";
import { loadUnderConstruction } from "./module-under-construction";

/** ADD Wave 1 creates `packages/shared/src/onboarding/privacy-receipt.ts`. */
const loadBuildPrivacyReceipt = (): Promise<BuildPrivacyReceipt> =>
  loadUnderConstruction<BuildPrivacyReceipt>({
    modulePath: "../../src/onboarding/privacy-receipt",
    exportName: "buildPrivacyReceipt",
    ownedBy: "ADD Wave 1, the onboarding/privacy-receipt.ts task",
  });

/** An org whose creator signed up on a company address — the F-1 guard passes
 *  and a domain is inferred. */
const WITH_DOMAIN: PrivacyReceiptInput = {
  inferredInternalDomain: "acme.example",
  provenance: "org_creator_email",
};

/** An org whose creator signed up on free mail, or on nothing readable. The
 *  F-1 fail direction fires and NOTHING is inferred. */
const WITHOUT_DOMAIN: PrivacyReceiptInput = {
  inferredInternalDomain: null,
  provenance: null,
};

/**
 * Words that would claim a capability this tree does not have.
 *
 * R-CAPTURE binds: `packages/sdk-js` is a 19-line stub and STAYS one this
 * sprint (AD-24: "No capture code of any kind"). Every token below names
 * something we do not do — masking a field, redacting a value, recording or
 * replaying a session, scrubbing or anonymising or encrypting what we hold.
 * Saying any of them on this receipt would be the exact failure R2 exists to
 * remove, restated more confidently.
 */
const UNSHIPPED_CAPABILITY =
  /\bmask(?:ed|ing|s)?\b|\bredact\w*\b|\bscrub\w*\b|\banonymi[sz]\w*\b|\bencrypt\w*\b|\brecord(?:ing|s|ed)?\b|\breplay\w*\b|\bcaptur\w*\b|\bblur\w*\b|\bobfuscat\w*\b/i;

const lengthOf = (lines: readonly ReceiptLine[]): number => lines.length;

describe("buildPrivacyReceipt — AD-2, FR-O8, ruling R2", () => {
  // ---------------------------------------------------------------- §9 row 1
  test("the receipt renders seven lines", async () => {
    const buildPrivacyReceipt = await loadBuildPrivacyReceipt();

    // R2's table has exactly seven rows and each one is backed by a cited,
    // shipped fact. An eighth is a claim nobody checked; a sixth means one of
    // the seven proofs stopped being told.
    expect(lengthOf(buildPrivacyReceipt(WITH_DOMAIN))).toBe(7);
    expect(lengthOf(buildPrivacyReceipt(WITHOUT_DOMAIN))).toBe(7);

    // The count does not move with the input — the no-domain case SUBSTITUTES
    // a sentence, it does not drop one. A six-line receipt in the case where we
    // know least is the case where the founder most needs the seventh line.
    expect(lengthOf(buildPrivacyReceipt(WITH_DOMAIN))).toBe(
      lengthOf(buildPrivacyReceipt(WITHOUT_DOMAIN)),
    );

    // Every line is a real sentence. A blank line reads as "nothing to say
    // here", which on this block is the most alarming thing it could say.
    for (const line of buildPrivacyReceipt(WITH_DOMAIN)) {
      expect(line.trim().length).toBeGreaterThan(0);
      expect(line.trim().endsWith(".")).toBe(true);
    }

    // ORDER, proved by determinism: the same input always yields the same
    // sequence. A receipt that shuffles is a receipt a founder cannot compare
    // against the one they read yesterday.
    expect(buildPrivacyReceipt(WITH_DOMAIN)).toEqual([...buildPrivacyReceipt(WITH_DOMAIN)]);
  });

  // ---------------------------------------------------------------- §9 row 2
  // Pre-check F2: §9's name wins over the checklist table's "renders no
  // editable control". ONE test, not two.
  test("the receipt exposes no editable control", async () => {
    const buildPrivacyReceipt = await loadBuildPrivacyReceipt();
    const receipt = buildPrivacyReceipt(WITH_DOMAIN);

    // TRUE BY TYPE, CHECKED AT RUNTIME. `ReceiptLine` is a string alias, so
    // there is no `field`, no `toggle`, no `action` and no `defaultValue` for
    // a renderer to find and turn into a control. This assertion is what
    // catches a Wave 1 that "helpfully" widens the alias to an object.
    for (const line of receipt) {
      expect(typeof line).toBe("string");
    }

    // And the copy does not offer one either. "Nothing here is a setting.
    // There is nothing to switch on" is the closing line UX row 11 makes
    // normative; a line inside the block that says "turn this off" would
    // contradict it in the same paragraph.
    for (const line of receipt) {
      expect(line).not.toMatch(/\bswitch (?:this |it )?(?:on|off)\b/i);
      expect(line).not.toMatch(/\bturn (?:this |it )?(?:on|off)\b/i);
      expect(line).not.toMatch(/\bchange (?:this|it) (?:here|below)\b/i);
      expect(line).not.toMatch(/\bsetting(?:s)? (?:page|panel)\b/i);
    }
  });

  // ---------------------------------------------------------------- §9 row 3
  test("an org with no inferred internal domain says so and says why", async () => {
    const buildPrivacyReceipt = await loadBuildPrivacyReceipt();

    const withDomain = buildPrivacyReceipt(WITH_DOMAIN);
    const withoutDomain = buildPrivacyReceipt(WITHOUT_DOMAIN);

    // EXACTLY ONE LINE MOVES, AT THE SAME INDEX. This is the order proof and
    // the substitution proof in one: §9's word is "substituted for the domain
    // line", and a receipt that appended the fail-direction sentence at the
    // end, or reordered around it, would fail here while passing a naive
    // "does it contain the sentence" check.
    const differing = withDomain
      .map((line, index) => (line === withoutDomain[index] ? null : index))
      .filter((index): index is number => index !== null);
    expect(differing).toHaveLength(1);

    const substituted = withoutDomain[differing[0] ?? -1] ?? "";

    // It SAYS SO — the inference did not happen…
    expect(substituted).toMatch(/could not|couldn't|were not able|was not able/i);

    // …and it SAYS WHY, in the F-1/F-2 fail direction's own terms: we would
    // rather miss the customer's own team than hide their real users. This is
    // the D10 sentence — an exclusion predicate that fires on a superset of its
    // target would erase the evidence behind a finding, so the product fails
    // toward setting NOTHING aside and says that out loud rather than guessing.
    expect(substituted).toMatch(/rather miss/i);
    expect(substituted).toMatch(/real users/i);

    // And it never states the failure as an error the founder must go and fix.
    // Nothing is broken: this is the designed direction.
    expect(substituted).not.toMatch(/\berror\b|\bfailed\b|\binvalid\b/i);
  });

  // ---------------------------------------------------------------- §9 row 4
  test("an org with an inferred internal domain names the value and its provenance", async () => {
    const buildPrivacyReceipt = await loadBuildPrivacyReceipt();
    const receipt = buildPrivacyReceipt(WITH_DOMAIN);

    // FR-O28 is the P1 half of this row and is on the PRD's cut list. The
    // value being NAMED is what a founder needs to spot that we inferred the
    // wrong domain before it silently sets aside the wrong sessions.
    const naming = receipt.filter((line) =>
      line.includes(WITH_DOMAIN.inferredInternalDomain ?? ""),
    );
    expect(naming).toHaveLength(1);

    // Provenance, in plain English rather than as the enum member: the only
    // shipped value is `org_creator_email`, and "org_creator_email" on a
    // screen is exactly the machine identifier product decisions §10 forbids.
    expect(naming[0]).toMatch(/email/i);
    expect(naming[0]).not.toMatch(/org_creator_email/);

    // DEGRADES CLEANLY WHEN THE P1 HALF IS CUT. If FR-O28 is dropped, the
    // domain line must still be a complete, honest sentence about the posture
    // — the receipt does not depend on naming the value to make sense. Proved
    // by the no-domain case standing alone as a full seven-line receipt, which
    // is the same shape a cut would leave behind.
    const cut = buildPrivacyReceipt(WITHOUT_DOMAIN);
    expect(cut).toHaveLength(7);
    for (const line of cut) {
      expect(line.trim().endsWith(".")).toBe(true);
    }
  });

  // ---------------------------------------------------------------- §9 row 5
  test("no receipt line claims a capability packages/sdk-js does not have", async () => {
    const buildPrivacyReceipt = await loadBuildPrivacyReceipt();

    // POSITIVE CONTROL FIRST, per the ADD's standing rule: a scanner that
    // matched nothing would report green forever. The planted offender is the
    // literal sentence R2 replaced — the one `docs/get-started.md` still
    // promises today and AD-21 removes this sprint.
    expect("Your masking config was verified.").toMatch(UNSHIPPED_CAPABILITY);
    expect("We record every session so you can replay it.").toMatch(UNSHIPPED_CAPABILITY);
    // NEGATIVE CONTROL: a sentence about something we genuinely do ship must
    // NOT trip it, or the scan is just a ban on writing about privacy.
    expect("We keep no bag of event properties at all.").not.toMatch(UNSHIPPED_CAPABILITY);

    const offenders = [
      ...buildPrivacyReceipt(WITH_DOMAIN),
      ...buildPrivacyReceipt(WITHOUT_DOMAIN),
    ].filter((line) => UNSHIPPED_CAPABILITY.test(line));

    expect(offenders).toEqual([]);
  });
});
