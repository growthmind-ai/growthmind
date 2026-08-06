import type { ScopedDb } from "@growthmind/db";
import type { CredentialKeyResolution, DecryptResult, TenantContext } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import * as replayDeps from "../../lib/replay/deps";
import type { RecordingSourceState, RecordingSourceStateFor } from "../../lib/replay/deps";

interface SourceStatePort {
  readonly recordingSourceStateOf: (opened: DecryptResult | null) => RecordingSourceState;
  readonly makeRecordingSourceState: (
    db: ScopedDb,
    resolution: CredentialKeyResolution,
  ) => RecordingSourceStateFor;
}

const RECORDING_SOURCE_STATES: readonly RecordingSourceState[] = [
  "ready",
  "no_connection",
  "unreadable_credential",
  "not_configured",
];

const AD_CTX: TenantContext = {
  userId: "ad-user-1",
  organizationId: "ad-org-1",
  organizationName: "Ad Org",
  role: "owner",
};

const AD_PROJECT_ID = "ad-project-1";

const AD_PERSONAL_API_KEY = "phx_ad_personal_api_key";

const port = replayDeps as unknown as Partial<SourceStatePort>;

function stateOf(): SourceStatePort["recordingSourceStateOf"] {
  const subject = port.recordingSourceStateOf;
  if (subject === undefined) {
    throw new Error("lib/replay/deps does not export recordingSourceStateOf yet (AD-6)");
  }
  return subject;
}

function makeStateFor(): SourceStatePort["makeRecordingSourceState"] {
  const subject = port.makeRecordingSourceState;
  if (subject === undefined) {
    throw new Error("lib/replay/deps does not export makeRecordingSourceState yet (AD-6)");
  }
  return subject;
}

// A loud fake: every property access throws, so any database work at all fails the test that
// forbids it, instead of returning undefined and passing.
function dbThatMustNotBeTouched(): ScopedDb {
  return new Proxy({} as unknown as object, {
    get(_target, property) {
      throw new Error(
        `the source-state port reached the database (.${String(property)}) on the ` +
          `not_configured path — a self-hosted install with no key must do no I/O`,
      );
    },
  }) as unknown as ScopedDb;
}

describe("recordingSourceStateOf", () => {
  test("should read no_connection when no credential is stored", () => {
    expect(stateOf()(null)).toBe("no_connection");
  });

  test("should read unreadable_credential when the stored credential will not open", () => {
    const opened: DecryptResult = { ok: false, reason: "authentication_failed" };

    expect(stateOf()(opened)).toBe("unreadable_credential");
  });

  test("should read ready when the credential opens", () => {
    const opened: DecryptResult = { ok: true, value: AD_PERSONAL_API_KEY };

    expect(stateOf()(opened)).toBe("ready");
  });

  test("should never return the credential to its caller", () => {
    const result: unknown = stateOf()({ ok: true, value: AD_PERSONAL_API_KEY });

    expect(typeof result).toBe("string");
    expect(RECORDING_SOURCE_STATES).toContain(result as RecordingSourceState);
    expect(JSON.stringify(result)).not.toContain(AD_PERSONAL_API_KEY);
  });
});

describe("makeRecordingSourceState", () => {
  test("should answer not_configured without touching the database", async () => {
    const unresolved: CredentialKeyResolution = { ok: false, reason: "malformed_key" };

    const stateFor = makeStateFor()(dbThatMustNotBeTouched(), unresolved);
    const state = await stateFor({ ctx: AD_CTX, projectId: AD_PROJECT_ID });

    expect(state).toBe("not_configured");
  });
});
