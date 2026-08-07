import { randomUUID } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  buildAgentFirstContactDedupKey,
  buildAnalysisFailingDedupKey,
  buildBackfillCompleteDedupKey,
  buildDigestDedupKey,
  buildFindingDeliveredDedupKey,
  buildKeyCreatedDedupKey,
  buildKeysRevokedDedupKey,
  buildSlackDisconnectedDedupKey,
} from "../../src/notifications/dedup";

// D12: a dedup key is exactly as stable as its least stable input. Every guarantee in this
// sprint — once-ever, one notification per delivery, one per revocation transition — hangs
// off these strings, so each is pinned across the churn its inputs actually see.

describe("the first-contact key is the once-ever mechanism", () => {
  test("takes no arguments by signature — no key-derived component can ever enter", () => {
    // A key id churns through revoke and re-mint; a second key's first use must hit the
    // same org-unique key, so the builder cannot even accept one (ADD D-2).
    expect(buildAgentFirstContactDedupKey.length).toBe(0);
  });

  test("is the type constant alone, identical on every call", () => {
    expect(buildAgentFirstContactDedupKey()).toBe("agent_first_contact");
    expect(buildAgentFirstContactDedupKey()).toBe(buildAgentFirstContactDedupKey());
  });
});

describe("the finding-delivered key is the delivery identity", () => {
  const findingId = randomUUID();
  const channelId = "C01AB2CD3EF";

  test("identical across a re-mark of the same delivery, so a retry changes nothing", () => {
    // The realistic churn is a D4 re-mark: the same minted finding id and the same Slack
    // channel id recomputed on the retry path must land on the same row.
    const first = buildFindingDeliveredDedupKey(findingId, channelId);
    const reMark = buildFindingDeliveredDedupKey(findingId, channelId);

    expect(reMark).toBe(first);
    expect(first).toBe(`finding_delivered:${findingId}:${channelId}`);
  });

  test("a second finding in the same channel is a second identity", () => {
    const other = buildFindingDeliveredDedupKey(randomUUID(), channelId);

    expect(other).not.toBe(buildFindingDeliveredDedupKey(findingId, channelId));
  });

  test("the same finding reaching a second channel is a second delivery fact", () => {
    const moved = buildFindingDeliveredDedupKey(findingId, "C08MOVED002");

    expect(moved).not.toBe(buildFindingDeliveredDedupKey(findingId, channelId));
  });
});

describe("the keys-revoked key is per minted transition", () => {
  test("one event id, one key — recomputing does not fork it", () => {
    const eventId = randomUUID();

    expect(buildKeysRevokedDedupKey(eventId)).toBe(`keys_revoked:${eventId}`);
    expect(buildKeysRevokedDedupKey(eventId)).toBe(buildKeysRevokedDedupKey(eventId));
  });

  test("a second revocation transition mints a second key", () => {
    // The repo mints a fresh event id per real transition; two transitions are two
    // notifications by design — the key must not collapse them.
    expect(buildKeysRevokedDedupKey(randomUUID())).not.toBe(buildKeysRevokedDedupKey(randomUUID()));
  });
});

describe("the key-created key is per mint", () => {
  test("the fresh key row's id is the identity — stable on recompute, forking per mint", () => {
    // Key ids churn across revoke-and-re-mint, and that fork is wanted here: per-mint
    // dedup is ruling 4's intent, the opposite side of D12 from keys_revoked.
    const keyId = randomUUID();

    expect(buildKeyCreatedDedupKey(keyId)).toBe(`key_created:${keyId}`);
    expect(buildKeyCreatedDedupKey(keyId)).toBe(buildKeyCreatedDedupKey(keyId));
    expect(buildKeyCreatedDedupKey(randomUUID())).not.toBe(buildKeyCreatedDedupKey(keyId));
  });
});

describe("the two event-minted keys vary per transition", () => {
  test("backfill_complete holds for one minted event and forks for the next drain", () => {
    const eventId = randomUUID();

    expect(buildBackfillCompleteDedupKey(eventId)).toBe(`backfill_complete:${eventId}`);
    expect(buildBackfillCompleteDedupKey(eventId)).toBe(buildBackfillCompleteDedupKey(eventId));
    expect(buildBackfillCompleteDedupKey(randomUUID())).not.toBe(
      buildBackfillCompleteDedupKey(randomUUID()),
    );
  });

  test("slack_disconnected holds for one minted event and forks for the next edge", () => {
    const eventId = randomUUID();

    expect(buildSlackDisconnectedDedupKey(eventId)).toBe(`slack_disconnected:${eventId}`);
    expect(buildSlackDisconnectedDedupKey(eventId)).toBe(buildSlackDisconnectedDedupKey(eventId));
    expect(buildSlackDisconnectedDedupKey(randomUUID())).not.toBe(
      buildSlackDisconnectedDedupKey(randomUUID()),
    );
  });
});

describe("the analysis-failing key varies per run", () => {
  const projectId = randomUUID();
  const runId = randomUUID();

  test("stable for one (project, run) — a D4 replay of the same trip changes nothing", () => {
    expect(buildAnalysisFailingDedupKey(projectId, runId)).toBe(
      `analysis_failing:${projectId}:${runId}`,
    );
    expect(buildAnalysisFailingDedupKey(projectId, runId)).toBe(
      buildAnalysisFailingDedupKey(projectId, runId),
    );
  });

  test("a later run tripping the same project is a new fact, not a conflict", () => {
    expect(buildAnalysisFailingDedupKey(projectId, randomUUID())).not.toBe(
      buildAnalysisFailingDedupKey(projectId, runId),
    );
  });

  test("the same run id under another project is another identity", () => {
    expect(buildAnalysisFailingDedupKey(randomUUID(), runId)).not.toBe(
      buildAnalysisFailingDedupKey(projectId, runId),
    );
  });
});

describe("the digest key is the window's own end instant", () => {
  const organizationId = randomUUID();
  const windowEnd = "2026-08-10T00:00:00.000Z";

  test("stable for one (org, windowEnd) — a second run of the same hour cannot mint a second summary", () => {
    expect(buildDigestDedupKey(organizationId, windowEnd)).toBe(
      `digest:${organizationId}:${windowEnd}`,
    );
    expect(buildDigestDedupKey(organizationId, windowEnd)).toBe(
      buildDigestDedupKey(organizationId, windowEnd),
    );
  });

  test("the next window is the next summary", () => {
    expect(buildDigestDedupKey(organizationId, "2026-08-17T00:00:00.000Z")).not.toBe(
      buildDigestDedupKey(organizationId, windowEnd),
    );
  });

  test("another org's identical window is another org's summary", () => {
    expect(buildDigestDedupKey(randomUUID(), windowEnd)).not.toBe(
      buildDigestDedupKey(organizationId, windowEnd),
    );
  });
});
