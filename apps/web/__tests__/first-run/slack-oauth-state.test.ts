import { describe, expect, test } from "bun:test";

import {
  assertUnderConstruction,
  loadUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";

const OWNER = "ADD Wave 4 (apps/web/lib/slack/oauth.ts, AD-5)";

interface OAuthStateIdentity {
  readonly userId: string;
  readonly organizationId: string;
}

interface OAuthStateVerifierDeps {
  readonly secret: string;
  readonly now: () => Date;
}

interface OAuthStateSignerDeps extends OAuthStateVerifierDeps {
  readonly nonce: () => string;
}

interface SignedOAuthState {
  readonly cookieValue: string;
  readonly stateParameter: string;
  readonly expiresAt: Date;
}

type SignOAuthState = (
  input: { readonly identity: OAuthStateIdentity },
  deps: OAuthStateSignerDeps,
) => SignedOAuthState;

interface VerifyOAuthStateInput {
  readonly cookieValue: string | null;
  readonly stateParameter: string | null;
  readonly expected: OAuthStateIdentity;
}

type VerifyOAuthStateResult = { readonly ok: true } | { readonly ok: false; readonly code: string };

type VerifyOAuthState = (
  input: VerifyOAuthStateInput,
  deps: OAuthStateVerifierDeps,
) => VerifyOAuthStateResult;

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

async function loadSigner(): Promise<{
  readonly sign: SignOAuthState;
  readonly verify: VerifyOAuthState;
}> {
  return { sign: await loadSign(), verify: await loadVerify() };
}

const SECRET = "first-run-oauth-fixture-secret-not-a-real-one";
const OTHER_SECRET = "another-installations-fixture-secret-also-not-real";

const SIGNED_AT = new Date("2026-08-01T10:00:00.000Z");

const FOUNDER: OAuthStateIdentity = {
  userId: "usr_founder_of_org_a",
  organizationId: "org_a",
};

const FOUNDER_ELSEWHERE: OAuthStateIdentity = {
  userId: FOUNDER.userId,
  organizationId: "org_b",
};

const TEAMMATE: OAuthStateIdentity = {
  userId: "usr_teammate_of_org_a",
  organizationId: FOUNDER.organizationId,
};

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

function codeOf(result: VerifyOAuthStateResult): string {
  expect(result.ok).toBe(false);

  if (result.ok) throw new Error("unreachable — the expectation above owns this");

  assertUnderConstruction(typeof result.code === "string" && result.code.length > 0, {
    contract: "a refused verifyOAuthState result carries a `code` naming why it refused",
    ownedBy: OWNER,
  });

  return result.code;
}

function expiryOf(signed: SignedOAuthState): Date {
  assertUnderConstruction(signed.expiresAt instanceof Date, {
    contract:
      "signOAuthState returns the `expiresAt` instant it signed into the state, so a caller " +
      "can set the cookie's Max-Age from the same value the MAC covers",
    ownedBy: OWNER,
  });

  return signed.expiresAt;
}

/** The replacement stays inside the base64url alphabet: this row is about the MAC refusing an edited payload, not about a decoder choking on an unknown character. */
function editedAt(value: string, index: number): string {
  return `${value.slice(0, index)}${value[index] === "A" ? "B" : "A"}${value.slice(index + 1)}`;
}

/** The FINAL character is excluded: in base64url it can carry fewer than six significant bits, so an edit there need not change the bytes the MAC covers. */
function tamperPositions(value: string): readonly number[] {
  const last = value.length - 1;
  const mid = Math.floor(value.length / 2);

  return [...new Set([0, 1, mid, mid + 1, last - 1])].filter((index) => index >= 0 && index < last);
}

describe("signOAuthState / verifyOAuthState — AD-5, the CSRF binding", () => {
  test("the cookie value and the state parameter are the same string", async () => {
    const sign = await loadSign();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

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

    // DUAL 1 of 2 - kills "cookie === parameter and nothing else": two copies of a forgery match each other perfectly.
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

    const fromThisBrowser = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));
    const fromSomewhereElse = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-two"));

    // DUAL 2 of 2 - kills "verify the signature and nothing else": a valid state that never came from THIS browser is the CSRF hole itself.
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

    // ONLY the organisation differs from FOUNDER - otherwise the row would pass against a signer that never covered it.
    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    const result = verify(
      {
        cookieValue: signed.cookieValue,
        stateParameter: signed.stateParameter,
        expected: FOUNDER_ELSEWHERE,
      },
      verifierDeps(msAfter(SIGNED_AT, 30_000)),
    );

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

    // The boundary is stated from BOTH sides, here and in the row below, so neither an off-by-one that expires everything nor one that expires nothing can pass.
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

    // A RANGE, NOT A NUMBER - the ADD names no lifetime: too short refuses a founder who read the consent screen carefully, too long leaves a state in browser history redeemable all day.
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

    // `if (cookie && cookie !== parameter) refuse` reads as a careful comparison and lets EVERY cookie-less request through - exactly what an attacker's link produces.
    expect(result.ok).toBe(false);
  });

  test("an empty-string cookie is refused exactly as an absent one is", async () => {
    const { sign, verify } = await loadSigner();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    const result = verify(
      { cookieValue: "", stateParameter: signed.stateParameter, expected: FOUNDER },
      verifierDeps(msAfter(SIGNED_AT, 30_000)),
    );

    expect(result.ok).toBe(false);
  });

  test("a missing state parameter is refused", async () => {
    const { sign, verify } = await loadSigner();

    const signed = sign({ identity: FOUNDER }, signerDeps(SIGNED_AT, "nonce-one"));

    const result = verify(
      { cookieValue: signed.cookieValue, stateParameter: null, expected: FOUNDER },
      verifierDeps(msAfter(SIGNED_AT, 30_000)),
    );

    expect(result.ok).toBe(false);
  });

  test("a callback carrying neither the cookie nor the parameter is refused", async () => {
    const verify = await loadVerify();

    // Nothing to compare is the one case where "they match" is vacuously true.
    const result = verify(
      { cookieValue: null, stateParameter: null, expected: FOUNDER },
      verifierDeps(SIGNED_AT),
    );

    expect(result.ok).toBe(false);
  });

  test("a state signed under another installation's secret is refused", async () => {
    const { sign, verify } = await loadSigner();

    // Signed by a real signer at a real instant; the ONLY thing wrong with it is the key - which is what proves the MAC is keyed, not a hash anybody could recompute.
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

    // Without this row the nonce could be dropped from the MAC's input and every other row would stay green - one state per founder per clock tick, replayable.
    expect(first.stateParameter).not.toBe(second.stateParameter);
  });

  test("a value that is not a signed state at all is refused, never thrown", async () => {
    const verify = await loadVerify();

    const at = verifierDeps(SIGNED_AT);

    // A verifier that throws on undecodable input turns a refusal into a 500, where retry logic and error pages start deciding things (D5/D8).
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

    // Both are correct refusals; collapsing them into one code costs the operator the only signal telling a slow founder from somebody probing the endpoint.
    expect(codeOf(expired)).not.toBe(codeOf(forged));
  });
});
