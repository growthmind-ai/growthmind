import { createHmac } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  SLACK_SIGNATURE_VERSION,
  SLACK_TIMESTAMP_TOLERANCE_MS,
  verifySlackSignature,
} from "../../lib/slack/signature";

const SIGNING_SECRET = "slack-fixture-signing-secret-never-real";

const RAW_BODY =
  "payload=%7B%22type%22%3A%22block_actions%22%2C%22channel%22%3A%7B%22id%22%3A%22C0GROWTH%22%7D%7D";

const PRESSED_AT = new Date("2026-08-03T09:00:00.000Z");

const TIMESTAMP = String(Math.floor(PRESSED_AT.getTime() / 1000));

const TIMESTAMP_MS = Number(TIMESTAMP) * 1000;

function sign(input: { timestamp?: string; rawBody?: string; secret?: string } = {}): string {
  const digest = createHmac("sha256", input.secret ?? SIGNING_SECRET)
    .update(
      `${SLACK_SIGNATURE_VERSION}:${input.timestamp ?? TIMESTAMP}:${input.rawBody ?? RAW_BODY}`,
    )
    .digest("hex");
  return `${SLACK_SIGNATURE_VERSION}=${digest}`;
}

function verify(input: {
  signature?: string | null;
  timestamp?: string | null;
  rawBody?: string;
  nowMs?: number;
}) {
  return verifySlackSignature({
    signingSecret: SIGNING_SECRET,
    signature: input.signature === undefined ? sign() : input.signature,
    timestamp: input.timestamp === undefined ? TIMESTAMP : input.timestamp,
    rawBody: input.rawBody ?? RAW_BODY,
    now: new Date(input.nowMs ?? TIMESTAMP_MS),
  });
}

describe("verifySlackSignature", () => {
  test("rejects an interactivity request with no signature", () => {
    expect(verify({ signature: null })).toEqual({ ok: false, reason: "missing" });

    expect(verify({ signature: "" })).toEqual({ ok: false, reason: "missing" });

    // The other half of "unsigned": a signature with no timestamp to bind it to is
    // replayable forever, so it is refused for the same reason.
    expect(verify({ timestamp: null })).toEqual({ ok: false, reason: "missing" });
  });

  test("rejects an interactivity request whose timestamp is stale", () => {
    expect(verify({ nowMs: TIMESTAMP_MS + SLACK_TIMESTAMP_TOLERANCE_MS + 1 })).toEqual({
      ok: false,
      reason: "stale",
    });

    expect(verify({ nowMs: TIMESTAMP_MS + SLACK_TIMESTAMP_TOLERANCE_MS - 1 })).toEqual({
      ok: true,
    });

    expect(SLACK_TIMESTAMP_TOLERANCE_MS).toBe(5 * 60 * 1000);
  });

  test("accepts an interactivity request signed with the configured secret", () => {
    expect(verify({})).toEqual({ ok: true });

    const oneByteChanged = `${RAW_BODY}0`;
    expect(verify({ rawBody: oneByteChanged })).toEqual({ ok: false, reason: "mismatch" });

    expect(verify({ signature: sign({ secret: "another-workspace-secret" }) })).toEqual({
      ok: false,
      reason: "mismatch",
    });

    // No `malformed` arm exists on the result union, so a header carrying no `v0=`
    // prefix has to land on one of the two refusals that do.
    const versionless = sign().slice(`${SLACK_SIGNATURE_VERSION}=`.length);
    const result = verify({ signature: versionless });
    expect(result.ok).toBe(false);
    expect(["missing", "mismatch"]).toContain(result.ok ? "" : result.reason);
  });

  test("rejects a version prefix carrying no signature at all", () => {
    expect(verify({ signature: `${SLACK_SIGNATURE_VERSION}=` })).toEqual({
      ok: false,
      reason: "mismatch",
    });

    expect(verify({ signature: `${SLACK_SIGNATURE_VERSION}=00` })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  test("rejects an interactivity request timestamped into the future", () => {
    const aheadBeyondTolerance = TIMESTAMP_MS - SLACK_TIMESTAMP_TOLERANCE_MS - 1;
    expect(verify({ nowMs: aheadBeyondTolerance })).toEqual({ ok: false, reason: "stale" });

    const aheadWithinTolerance = TIMESTAMP_MS - SLACK_TIMESTAMP_TOLERANCE_MS + 1;
    expect(verify({ nowMs: aheadWithinTolerance })).toEqual({ ok: true });
  });
});
