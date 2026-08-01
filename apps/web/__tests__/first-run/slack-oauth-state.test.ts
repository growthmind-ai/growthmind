// THE OAUTH STATE SIGNER — AD-5. Wave 0, task 0.3.
//
// ###########################################################################
// # WHAT THIS MECHANISM IS FOR, IN THE ADD'S OWN WORDS (AD-5, lines 221-222):
// #
// #   "CSRF is the whole point: without it, an attacker's `code` can be
// #    redeemed into the victim's org."
// #
// # That sentence is the entire subject of this file. An attacker completes
// # Slack's consent screen against THEIR OWN workspace, keeps the resulting
// # `code`, and gets a signed-in victim's browser to open
// # `/api/first-run/slack/oauth/callback?code=<attacker's>&state=<anything>`.
// # If the callback exchanges that code, the attacker's Slack workspace
// # becomes the VICTIM'S ORGANISATION'S delivery channel — and from then on
// # every finding this product writes about the victim's funnel is posted into
// # a room the attacker owns. There is no error anywhere, and the victim's
// # screen says "connected".
// #
// # AD-5 stops it with a value that is BOTH an httpOnly cookie AND the `state`
// # parameter, HMAC'd over `{userId, organizationId, nonce, expiresAt}` keyed
// # by `BETTER_AUTH_SECRET`. "The callback requires BOTH and that they match."
// ###########################################################################
//
// ── THE TWO ROWS THAT ARE DUALS, AND WHY BOTH HAVE TO BE HERE ───────────────
//
// "Requires both and that they match" is two independent obligations, and each
// one has an implementation that satisfies the other while failing it:
//
//   * An implementation that ONLY compares `cookie === parameter` passes every
//     mismatch row and every absence row, and accepts a value an attacker
//     forged wholesale — because two copies of a forgery match each other.
//     `a state edited on BOTH sides is refused by the signature` is the row
//     that kills it.
//   * An implementation that ONLY verifies the signature passes every forgery
//     row and accepts a valid state that never came from THIS browser — which
//     is the CSRF hole itself, since the `state` parameter travels in a URL an
//     attacker can compose. `two individually valid states, crossed, are
//     refused` is the row that kills that one.
//
// Neither row alone is the contract. Both are.
//
// ── WHY EVERY IDENTITY ROW CHANGES EXACTLY ONE FIELD ────────────────────────
//
// The rows that flip organisation and user flip ONE of them and hold the other
// fixed. A row that changed both would pass against an implementation that
// signed only the user id and forgot the organisation entirely — and the
// organisation is the field the attack above turns on. One field at a time is
// what proves each field is inside the MAC.
//
// ── THE CLOCK AND THE SECRET ARE INJECTED, AND THE ROWS PROVE IT ────────────
//
// No row below reads a wall clock. `signOAuthState` and `verifyOAuthState`
// each take their `now` from deps, so the expiry rows state an exact instant
// and mean it; a `Date.now()` inside the module would make the boundary row a
// coin flip that passes on a fast machine. The secret comes from deps for the
// same reason one level along: `a state signed under another installation's
// secret is refused` cannot be written at all against a module that reads
// `env.BETTER_AUTH_SECRET` at import.
//
// EVERY ROW IS RED TODAY. `apps/web/lib/slack/oauth.ts` is ADD Wave 4's (file
// plan line 369). The loader turns that absence into a NAMED diagnostic that
// states the missing behaviour and its owner, rather than a bare TS2307 that
// reads as a broken checkout — see `module-under-construction.ts`.
import { describe, expect, test } from "bun:test";

import {
  assertUnderConstruction,
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";

const OWNER = "ADD Wave 4 (apps/web/lib/slack/oauth.ts, AD-5)";

// ===========================================================================
// The contract mirror
//
// AD-5 states this module in prose, not in TypeScript, so — unlike the shapes
// in `packages/shared/__tests__/onboarding/contract-shapes.ts`, which are
// copied from an ADD block that declares them — the declarations below are
// DERIVED. Each carries the ADD sentence it comes from. Where the ADD is
// silent (the refusal vocabulary, the lifetime) the rows below say so out loud
// and pin only the property that has a security argument behind it, never an
// arbitrary literal this suite would be inventing on Wave 4's behalf.
// ===========================================================================

/**
 * The two fields AD-5 binds the state to: `{userId, organizationId, …}`.
 *
 * BOTH, NOT EITHER. The user id alone would let a founder who belongs to two
 * organisations have a state signed while acting in one redeemed while acting
 * in the other — a same-person, wrong-tenant write (D7), which is the quiet
 * cousin of the cross-attacker case in the header.
 */
interface OAuthStateIdentity {
  readonly userId: string;
  readonly organizationId: string;
}

/**
 * What the verifier needs from outside itself.
 *
 * `secret` is the installation's `BETTER_AUTH_SECRET` (AD-5, line 217), passed
 * rather than read, so a suite can drive two installations. `now` is the
 * repository's clock convention verbatim — `readonly now: () => Date`, exactly
 * as `apps/web/lib/first-run/deps.ts:69` declares it.
 */
interface OAuthStateVerifierDeps {
  readonly secret: string;
  readonly now: () => Date;
}

/**
 * The signer's deps: the verifier's, plus the source of the nonce.
 *
 * The nonce is injected for the same reason the clock is. AD-5 puts it inside
 * the signed payload, and the only way to state "two states for the same
 * founder in the same millisecond differ" as an assertion rather than a hope
 * is to hand the signer both nonces. `packages/db`'s session source takes its
 * randomness the same way (`random: () => Math.random()`, `deps.ts:118`).
 */
interface OAuthStateSignerDeps extends OAuthStateVerifierDeps {
  readonly nonce: () => string;
}

/**
 * One signed state.
 *
 * `cookieValue` and `stateParameter` are the SAME string: AD-5 says the value
 * is "set httpOnly/SameSite=Lax and echoed as `state`", and echoed means
 * echoed. Two fields rather than one because the callback reads them from two
 * different places and the row that crosses them has to be writable.
 *
 * `expiresAt` is returned rather than kept private so the expiry rows can ask
 * the signer where its own boundary is instead of hard-coding a lifetime this
 * suite would be choosing for Wave 4.
 */
interface SignedOAuthState {
  readonly cookieValue: string;
  readonly stateParameter: string;
  readonly expiresAt: Date;
}

type SignOAuthState = (
  input: { readonly identity: OAuthStateIdentity },
  deps: OAuthStateSignerDeps,
) => SignedOAuthState;

/**
 * What the callback presents.
 *
 * `cookieValue` and `stateParameter` are `string | null` because BOTH are
 * genuinely absent in production — a request that never went through
 * `oauth/start`, a browser that dropped the cookie, a hand-typed callback URL.
 * `expected` is the identity of the SESSION THAT IS CALLING, and it is a
 * required argument for the reason `FirstRunRouteDeps` has no `organizationId`
 * on it: a verifier that could be called without one could be called with the
 * wrong one.
 */
interface VerifyOAuthStateInput {
  readonly cookieValue: string | null;
  readonly stateParameter: string | null;
  readonly expected: OAuthStateIdentity;
}

/**
 * `ok` and a `code` — never a thrown error and never a bare boolean.
 *
 * A refusal reaches a log and a redirect, and a callback that cannot say WHY
 * it refused leaves an operator unable to tell a founder who took too long
 * over the consent screen from somebody probing the endpoint. The `code` is
 * typed `string` rather than a literal union deliberately: AD-5 names no
 * refusal vocabulary, so pinning the exact spellings here would be this suite
 * legislating rather than describing. The one property with an argument behind
 * it — that a slow founder and a forgery do not collapse into one code — is a
 * row of its own below.
 */
type VerifyOAuthStateResult = { readonly ok: true } | { readonly ok: false; readonly code: string };

type VerifyOAuthState = (
  input: VerifyOAuthStateInput,
  deps: OAuthStateVerifierDeps,
) => VerifyOAuthStateResult;

// ===========================================================================
// Loading the module Wave 4 writes
// ===========================================================================

const MODULE = underConstructionSpecifier("apps/web/lib/slack/oauth");

const loadSign = (): Promise<SignOAuthState> =>
  loadUnderConstruction<SignOAuthState>({
    modulePath: MODULE,
    exportName: "signOAuthState",
    ownedBy: OWNER,
  });

const loadVerify = (): Promise<VerifyOAuthState> =>
  loadUnderConstruction<VerifyOAuthState>({
    modulePath: MODULE,
    exportName: "verifyOAuthState",
    ownedBy: OWNER,
  });

/** Both halves, for the rows that sign a real state and then present it. */
async function loadSigner(): Promise<{
  readonly sign: SignOAuthState;
  readonly verify: VerifyOAuthState;
}> {
  return { sign: await loadSign(), verify: await loadVerify() };
}

// ===========================================================================
// Fixtures
// ===========================================================================

/**
 * Fixture secrets. THIS REPOSITORY IS PUBLIC — neither string is, was, or
 * resembles a real `BETTER_AUTH_SECRET`, and the second exists only so one row
 * can present a state signed by a DIFFERENT installation.
 */
const SECRET = "first-run-oauth-fixture-secret-not-a-real-one";
const OTHER_SECRET = "another-installations-fixture-secret-also-not-real";

const SIGNED_AT = new Date("2026-08-01T10:00:00.000Z");

/** The founder who clicked "Add to Slack", and the org they were acting in. */
const FOUNDER: OAuthStateIdentity = {
  userId: "usr_founder_of_org_a",
  organizationId: "org_a",
};

/** Same person, second organisation. The D7 row's counterpart. */
const FOUNDER_ELSEWHERE: OAuthStateIdentity = {
  userId: FOUNDER.userId,
  organizationId: "org_b",
};

/** Different person, same organisation. The teammate row's counterpart. */
const TEAMMATE: OAuthStateIdentity = {
  userId: "usr_teammate_of_org_a",
  organizationId: FOUNDER.organizationId,
};

/**
 * A frozen clock.
 *
 * Written here rather than imported from
 * `apps/web/__tests__/api/first-run/helpers/first-run-route-contract.ts`,
 * which exports the identical two lines: that helper is the route suites'
 * DATABASE-BACKED bed, and importing one function out of it would drag a
 * Postgres harness into a suite whose subject is a pure function over a
 * string. A three-line clock is the cheaper duplication.
 */
const clockAt =
  (instant: Date): (() => Date) =>
  () =>
    new Date(instant.getTime());

const msAfter = (base: Date, ms: number): Date => new Date(base.getTime() + ms);

const signerDeps = (at: Date, nonce: string, secret: string = SECRET): OAuthStateSignerDeps => ({
  secret,
  now: clockAt(at),
  nonce: () => nonce,
});

const verifierDeps = (at: Date, secret: string = SECRET): OAuthStateVerifierDeps => ({
  secret,
  now: clockAt(at),
});

/**
 * The refusal's code, with the absence of one named rather than compared as
 * `undefined === undefined` — which is what a bare read would silently become
 * against an implementation that returns `{ ok: false }` and nothing else.
 */
function codeOf(result: VerifyOAuthStateResult): string {
  expect(result.ok).toBe(false);

  if (result.ok) throw new Error("unreachable — the expectation above owns this");

  assertUnderConstruction(typeof result.code === "string" && result.code.length > 0, {
    contract: "a refused verifyOAuthState result carries a `code` naming why it refused",
    ownedBy: OWNER,
  });

  return result.code;
}

/** The signer's own expiry instant, named if it is absent. */
function expiryOf(signed: SignedOAuthState): Date {
  assertUnderConstruction(signed.expiresAt instanceof Date, {
    contract:
      "signOAuthState returns the `expiresAt` instant it signed into the state, so a caller " +
      "can set the cookie's Max-Age from the same value the MAC covers",
    ownedBy: OWNER,
  });

  return signed.expiresAt;
}

/**
 * The same string with ONE character replaced.
 *
 * The replacement is `A`/`B` so the result stays inside the base64url alphabet
 * — the row this feeds is about the MAC refusing an edited payload, not about
 * a decoder choking on a character it has never seen. That second concern is
 * its own row further down.
 */
function editedAt(value: string, index: number): string {
  return `${value.slice(0, index)}${value[index] === "A" ? "B" : "A"}${value.slice(index + 1)}`;
}

/**
 * Positions worth editing — THE FINAL CHARACTER DELIBERATELY EXCLUDED.
 *
 * In base64/base64url the last character can carry fewer than six significant
 * bits, so two different final characters can decode to the same bytes. An
 * edit there is not guaranteed to change what the MAC covers, and a row that
 * asserted it must be refused would be asserting a property of the padding
 * rather than of the signature. Every other position changes real bytes.
 */
function tamperPositions(value: string): readonly number[] {
  const last = value.length - 1;
  const mid = Math.floor(value.length / 2);

  return [...new Set([0, 1, mid, mid + 1, last - 1])].filter((index) => index >= 0 && index < last);
}

// ===========================================================================
// The rows
// ===========================================================================

describe("signOAuthState / verifyOAuthState — AD-5, the CSRF binding", () => {
  test("the cookie value and the state parameter are the same string", async () => {
    const sign = await loadSign();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    // AD-5: the value is "set httpOnly/SameSite=Lax and echoed as `state`".
    // Every mismatch row below reads as a mismatch only because of this.
    expect(signed.cookieValue).toBe(signed.stateParameter);
    expect(signed.cookieValue.length).toBeGreaterThan(0);
  });

  test("a valid cookie and parameter pair verifies for the identity it was signed for", async () => {
    const { sign, verify } = await loadSigner();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    const result = verify(
      {
        cookieValue: signed.cookieValue,
        stateParameter: signed.stateParameter,
        expected: FOUNDER,
      },
      verifierDeps(msAfter(SIGNED_AT, 30_000)),
    );

    expect(result.ok).toBe(true);
  });

  test("a state edited on BOTH sides is refused by the signature, not accepted as matching", async () => {
    const { sign, verify } = await loadSigner();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));
    const at = verifierDeps(msAfter(SIGNED_AT, 30_000));

    // THE ROW THAT KILLS "cookie === parameter AND NOTHING ELSE". An attacker
    // who can put a value in the URL can put the same value in both places;
    // two copies of a forgery match each other perfectly.
    for (const index of tamperPositions(signed.stateParameter)) {
      const tampered = editedAt(signed.stateParameter, index);

      const result = verify(
        { cookieValue: tampered, stateParameter: tampered, expected: FOUNDER },
        at,
      );

      expect({ index, ok: result.ok }).toEqual({ index, ok: false });
    }
  });

  test("two individually valid states, crossed, are refused", async () => {
    const { sign, verify } = await loadSigner();

    // Both are real signatures over the SAME identity — the only thing wrong
    // with the pair is that they did not come from the same start request.
    const fromThisBrowser = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));
    const fromSomewhereElse = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-two"));

    // THE ROW THAT KILLS "verify the signature AND NOTHING ELSE" — which is the
    // CSRF hole itself, because the `state` parameter travels in a URL the
    // attacker composes while the cookie does not.
    const result = verify(
      {
        cookieValue: fromThisBrowser.cookieValue,
        stateParameter: fromSomewhereElse.stateParameter,
        expected: FOUNDER,
      },
      verifierDeps(msAfter(SIGNED_AT, 30_000)),
    );

    expect(result.ok).toBe(false);
  });

  test("a state signed for organization A does not verify for organization B", async () => {
    const { sign, verify } = await loadSigner();

    // ONLY the organisation differs from `FOUNDER`; the user id is identical.
    // That is what makes this a claim about the organisation being inside the
    // MAC rather than a claim about the pair.
    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    const result = verify(
      {
        cookieValue: signed.cookieValue,
        stateParameter: signed.stateParameter,
        expected: FOUNDER_ELSEWHERE,
      },
      verifierDeps(msAfter(SIGNED_AT, 30_000)),
    );

    // THE SECURITY POINT OF THE WHOLE MECHANISM (AD-5, lines 221-222). If this
    // row is green and every other row in this file is red, the attack in the
    // header still does not work. If this row is red, the product's delivery
    // channel can be pointed at somebody else's Slack workspace.
    expect(result.ok).toBe(false);
  });

  test("a state signed for one user does not verify for their teammate", async () => {
    const { sign, verify } = await loadSigner();

    // The mirror of the row above: only the user id differs.
    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    const result = verify(
      {
        cookieValue: signed.cookieValue,
        stateParameter: signed.stateParameter,
        expected: TEAMMATE,
      },
      verifierDeps(msAfter(SIGNED_AT, 30_000)),
    );

    expect(result.ok).toBe(false);
  });

  test("a state verifies one millisecond before it expires", async () => {
    const { sign, verify } = await loadSigner();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    const result = verify(
      {
        cookieValue: signed.cookieValue,
        stateParameter: signed.stateParameter,
        expected: FOUNDER,
      },
      verifierDeps(msAfter(expiryOf(signed), -1)),
    );

    // The boundary is stated from BOTH sides, here and in the row below, so
    // neither an off-by-one that expires everything nor one that expires
    // nothing can pass. The clock is injected, so both are exact.
    expect(result.ok).toBe(true);
  });

  test("a state is refused at exactly the instant it expires", async () => {
    const { sign, verify } = await loadSigner();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    const result = verify(
      {
        cookieValue: signed.cookieValue,
        stateParameter: signed.stateParameter,
        expected: FOUNDER,
      },
      verifierDeps(expiryOf(signed)),
    );

    expect(result.ok).toBe(false);
  });

  test("a state expires within minutes of being signed, not hours", async () => {
    const sign = await loadSign();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));
    const lifetimeMs = expiryOf(signed).getTime() - SIGNED_AT.getTime();

    // A RANGE, NOT A NUMBER — AD-5 states that `expiresAt` is signed and says
    // nothing about how long it is for, so this suite pins the two things that
    // have an argument behind them and leaves the value to Wave 4. Too short
    // and a founder who reads Slack's consent screen is refused for being
    // careful; too long and a state lifted from a browser's history stays
    // redeemable for the rest of the day.
    expect(lifetimeMs).toBeGreaterThanOrEqual(2 * 60_000);
    expect(lifetimeMs).toBeLessThanOrEqual(15 * 60_000);
  });

  test("a missing cookie is refused, never treated as absent-and-therefore-fine", async () => {
    const { sign, verify } = await loadSigner();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    const result = verify(
      { cookieValue: null, stateParameter: signed.stateParameter, expected: FOUNDER },
      verifierDeps(msAfter(SIGNED_AT, 30_000)),
    );

    // THE SHAPE THIS ROW EXISTS FOR: `if (cookie && cookie !== parameter)
    // refuse` reads as a careful comparison and lets EVERY request with no
    // cookie straight through — which is precisely the request an attacker's
    // link produces, because they cannot write an httpOnly cookie into the
    // victim's browser. Absence is a refusal, not a skipped check.
    expect(result.ok).toBe(false);
  });

  test("an empty-string cookie is refused exactly as an absent one is", async () => {
    const { sign, verify } = await loadSigner();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    // What a cleared cookie looks like on the wire. A different shape from
    // `null` (D5) reaching the same guard.
    const result = verify(
      { cookieValue: "", stateParameter: signed.stateParameter, expected: FOUNDER },
      verifierDeps(msAfter(SIGNED_AT, 30_000)),
    );

    expect(result.ok).toBe(false);
  });

  test("a missing state parameter is refused", async () => {
    const { sign, verify } = await loadSigner();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    // The other half of "the callback requires BOTH". A cookie on its own is
    // not consent to redeem whatever `code` arrived beside it.
    const result = verify(
      { cookieValue: signed.cookieValue, stateParameter: null, expected: FOUNDER },
      verifierDeps(msAfter(SIGNED_AT, 30_000)),
    );

    expect(result.ok).toBe(false);
  });

  test("a callback carrying neither the cookie nor the parameter is refused", async () => {
    const verify = await loadVerify();

    // Nothing to compare is the one case where "they match" is vacuously true.
    // It is also the plainest description of a hand-composed callback URL.
    const result = verify(
      { cookieValue: null, stateParameter: null, expected: FOUNDER },
      verifierDeps(SIGNED_AT),
    );

    expect(result.ok).toBe(false);
  });

  test("a state signed under another installation's secret is refused", async () => {
    const { sign, verify } = await loadSigner();

    // Signed by a real signer, with a real nonce, at a real instant — the ONLY
    // thing wrong with it is the key. This is what proves the MAC is keyed by
    // `BETTER_AUTH_SECRET` (AD-5, line 217) and not merely a hash anybody
    // holding the payload could recompute.
    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one", OTHER_SECRET));

    const result = verify(
      {
        cookieValue: signed.cookieValue,
        stateParameter: signed.stateParameter,
        expected: FOUNDER,
      },
      verifierDeps(msAfter(SIGNED_AT, 30_000), SECRET),
    );

    expect(result.ok).toBe(false);
  });

  test("two states for the same founder in the same millisecond differ", async () => {
    const sign = await loadSign();

    const first = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));
    const second = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-two"));

    // AD-5 puts a nonce in the signed payload. Without this row the nonce could
    // be dropped from the MAC's input and every other row here would stay
    // green — leaving one state per founder per clock tick, replayable by
    // anybody who saw the URL once.
    expect(first.stateParameter).not.toBe(second.stateParameter);
  });

  test("a value that is not a signed state at all is refused, never thrown", async () => {
    const verify = await loadVerify();

    const at = verifierDeps(SIGNED_AT);

    // These arrive in production: a truncated redirect, a link a mail client
    // rewrote, somebody typing in the address bar. A verifier that throws on
    // undecodable input turns a refusal into a 500, and a 500 is where retry
    // logic and error pages start making decisions nobody designed (D5/D8).
    for (const garbage of ["not-a-signed-state", "....", "%%%", "a.b.c.d.e", "{}"]) {
      const result = verify(
        { cookieValue: garbage, stateParameter: garbage, expected: FOUNDER },
        at,
      );

      expect({ garbage, ok: result.ok }).toEqual({ garbage, ok: false });
    }
  });

  test("a slow founder and a forgery are refused with different codes", async () => {
    const { sign, verify } = await loadSigner();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    const expired = verify(
      {
        cookieValue: signed.cookieValue,
        stateParameter: signed.stateParameter,
        expected: FOUNDER,
      },
      verifierDeps(msAfter(expiryOf(signed), 1)),
    );

    const forged = verify(
      {
        cookieValue: "not-a-signed-state",
        stateParameter: "not-a-signed-state",
        expected: FOUNDER,
      },
      verifierDeps(msAfter(SIGNED_AT, 30_000)),
    );

    // Both are refusals and both are correct. Collapsing them into one code
    // costs an operator the only signal that tells "somebody read the consent
    // screen slowly" apart from "somebody is probing this endpoint" — and that
    // distinction is the whole reason a refusal carries a code at all.
    expect(codeOf(expired)).not.toBe(codeOf(forged));
  });
});
