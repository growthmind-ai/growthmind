import { randomUUID } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  buildAgentFirstContactDedupKey,
  buildFindingDeliveredDedupKey,
  buildKeysRevokedDedupKey,
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
