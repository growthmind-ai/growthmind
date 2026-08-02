// The row models the signing oracle instead of pinning a digest: it tests the property, not the output.
import { createHmac } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { signOAuthState, verifyOAuthState } from "../../lib/slack/oauth";

const SECRET = "first-run-oauth-fixture-secret-not-a-real-one";

const SIGNED_AT = new Date("2026-08-01T10:00:00.000Z");

const IDENTITY = { userId: "usr_founder_of_org_a", organizationId: "org_a" };

const clockAt =
  (instant: Date): (() => Date) =>
  () =>
    new Date(instant.getTime());

describe("the OAuth state MAC is domain-separated from Better Auth's own signing", () => {
  test("a signature from an unlabelled HMAC under the same secret is refused", () => {
    const signed = signOAuthState(
      { identity: IDENTITY },
      { secret: SECRET, now: clockAt(SIGNED_AT), nonce: () => "nonce-one" },
    );

    const [encodedPayload] = signed.stateParameter.split(".");

    const oracleSignature = createHmac("sha256", SECRET).update(encodedPayload).digest("base64url");
    const forged = `${encodedPayload}.${oracleSignature}`;

    const result = verifyOAuthState(
      { cookieValue: forged, stateParameter: forged, expected: IDENTITY },
      { secret: SECRET, now: clockAt(new Date(SIGNED_AT.getTime() + 30_000)) },
    );

    expect(result).toEqual({ ok: false, code: "state_signature_invalid" });
  });

  test("a state this file signed still verifies — the label is on both sides", () => {
    const signed = signOAuthState(
      { identity: IDENTITY },
      { secret: SECRET, now: clockAt(SIGNED_AT), nonce: () => "nonce-one" },
    );

    const result = verifyOAuthState(
      {
        cookieValue: signed.cookieValue,
        stateParameter: signed.stateParameter,
        expected: IDENTITY,
      },
      { secret: SECRET, now: clockAt(new Date(SIGNED_AT.getTime() + 30_000)) },
    );

    expect(result).toEqual({ ok: true });
  });
});
