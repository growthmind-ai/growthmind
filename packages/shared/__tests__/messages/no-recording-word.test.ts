// AC-8(a) / G8, half one of two. The other half is apps/web/__tests__/copy/no-recording-word.test.ts,
// and it is a separate file because a sweep scoped to this package passes while the DOM still
// says "recording" — the findings detail page holds a verbatim duplicate of a constant swept here.
import { describe, expect, test } from "bun:test";

import {
  ALL_COMPANIES_MESSAGES,
  ALL_FINDINGS_MESSAGES,
  ALL_RECORDING_NARRATION_MESSAGES,
  ALL_REPLAY_SOURCE_MESSAGES,
  LIVE_TOPICS,
  MCP_TOOLS,
  REPLAY_FAILURE_MESSAGES,
} from "../../src/index";

// The gate is the NOUN, and only the noun. "recorded" is correct English and the UX spec's own
// copy uses it ("simulated sessions aren't recorded"), so the pattern must clear it. A word
// boundary on both sides is also what keeps symbol names, keys and route segments out: every one
// of recordingId, RecordingMetaStamp, RECORDING_SUMMARY_PENDING, recording_not_found and
// [recordingId] continues with a word character where this pattern demands a boundary.
const NOUN = /\brecordings?\b/i;

// D-10: packages/shared/src/live/topics.ts is skipped, and named here so the skip is visible
// rather than silent. "recordings" there is a Postgres NOTIFY channel topic — a wire value read
// by no customer — and D1 keeps that file untouched by this sprint.
const EXCLUDED_FROM_THE_SWEEP: readonly string[] = ["packages/shared/src/live/topics.ts"];

// A host that the customer would have to read and act on. rrweb is not the vendor this
// installation talks to, and a message naming one carries an id from somewhere we do not own.
const VENDOR_HOST = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|net|dev|org|ai|app)\b/i;

const SWEPT_MESSAGE_GROUPS: readonly (readonly [string, readonly string[]])[] = [
  ["ALL_REPLAY_SOURCE_MESSAGES", ALL_REPLAY_SOURCE_MESSAGES],
  ["ALL_RECORDING_NARRATION_MESSAGES", ALL_RECORDING_NARRATION_MESSAGES],
  ["ALL_FINDINGS_MESSAGES", ALL_FINDINGS_MESSAGES],
  ["ALL_COMPANIES_MESSAGES", ALL_COMPANIES_MESSAGES],
  ["MCP_TOOLS[].description", MCP_TOOLS.map((tool) => tool.description)],
];

function offendersIn(messages: readonly string[]): readonly string[] {
  return messages.filter((message) => NOUN.test(message));
}

describe("the customer-facing word is Replays (AC-8(a), G8, D-10)", () => {
  test("CONTROL: the matcher fires on the noun, clears the verb, and clears every code shape", () => {
    for (const noun of [
      "We could not find that recording.",
      "No recordings yet.",
      "Recordings come from the same place your events do.",
      "This recording arrived empty",
    ]) {
      expect(`${noun}: ${NOUN.test(noun)}`).toBe(`${noun}: true`);
    }

    // The verb survives. This is the assertion that stops the sweep being satisfied by a
    // find-and-replace that also eats the correct English.
    for (const verb of [
      "Simulated sessions aren't recorded, so there is nothing to watch.",
      "Nothing was recorded in this session.",
      "2 matching sessions weren't recorded, so they aren't listed above.",
      "A session was recorded here.",
    ]) {
      expect(`${verb}: ${NOUN.test(verb)}`).toBe(`${verb}: false`);
    }

    // Symbol names, keys, columns and route segments are not string values and are not the gate.
    for (const codeShape of [
      "recordingId",
      "recordingSessionKey",
      "RecordingMetaStamp",
      "RECORDING_SUMMARY_PENDING",
      "recording_not_found",
      "recording_duration_seconds",
      "/replays/[recordingId]",
      "@/components/replay/RecordingSummaryCard",
    ]) {
      expect(`${codeShape}: ${NOUN.test(codeShape)}`).toBe(`${codeShape}: false`);
    }
  });

  test("no exported customer-facing message string contains the noun recording", () => {
    const offenders = SWEPT_MESSAGE_GROUPS.flatMap(([group, messages]) =>
      offendersIn(messages).map((message) => `${group}: ${JSON.stringify(message)}`),
    );

    if (offenders.length > 0) {
      throw new Error(
        `${offenders.length} exported customer-facing string(s) still say "recording". The ` +
          `customer-facing word is Replays (G8). The verb "recorded" is correct and must be ` +
          `left alone; only the noun goes. Symbol names, keys and route segments are not in ` +
          `this gate — it reads string values only. Offenders:\n  ${offenders.join("\n  ")}`,
      );
    }
    expect(offenders).toEqual([]);
  });

  test("the verb recorded survives the sweep in the group the UX spec grows", () => {
    // UX §6 puts the sprint's new strings in replay-source/messages.ts precisely so this sweep
    // covers them for free — and two of them (the §4.3 tail note, the simulated lane) are built
    // on the verb. Asserting the verb HERE rather than across every group is what stops the
    // sweep above being satisfied by a find-and-replace that ate the correct English too: a
    // rename that turns "weren't recorded" into "weren't replayed" passes the noun gate and
    // fails this one.
    const carryingTheVerb = ALL_REPLAY_SOURCE_MESSAGES.filter((message) =>
      /\brecorded\b/i.test(message),
    );

    if (carryingTheVerb.length === 0) {
      throw new Error(
        `ALL_REPLAY_SOURCE_MESSAGES carries no message using the verb "recorded". UX §4.3 and ` +
          `§6 author sentences that do — the tail note ("<N> matching sessions weren't ` +
          `recorded, so they aren't listed above.") and the simulated lane's permanent zero — ` +
          `and §6 states they live in replay-source/messages.ts so this sweep covers them. An ` +
          `empty result means either they have not been written yet (the Wave 0 red), or the ` +
          `rename ate the verb along with the noun. Present: ` +
          `${ALL_REPLAY_SOURCE_MESSAGES.length} message(s), none with the verb.`,
      );
    }

    expect(offendersIn(carryingTheVerb)).toEqual([]);
  });

  test("the live topics wire value is excluded from the sweep by name, and is still the wire value", () => {
    // GREEN AS A RATCHET, deliberately. Nothing here is red today; the row exists so that a
    // rename reaching into topics.ts — which would silently break every LISTEN/NOTIFY consumer,
    // with no customer-facing benefit at all — fails a test rather than a deploy.
    expect(EXCLUDED_FROM_THE_SWEEP).toContain("packages/shared/src/live/topics.ts");

    // The skip is only honest if the excluded value is one the sweep WOULD have caught.
    const wireValue = LIVE_TOPICS.find((topic) => NOUN.test(topic));
    if (wireValue === undefined) {
      throw new Error(
        `LIVE_TOPICS no longer carries a topic the noun sweep would fire on, so the exclusion ` +
          `above is now vacuous. Either the wire value was renamed — which D1 forbids, the topic ` +
          `is a Postgres NOTIFY channel name and not copy — or the exclusion should be deleted. ` +
          `Topics: ${LIVE_TOPICS.join(", ")}`,
      );
    }
    expect(wireValue).toBe("recordings");
  });

  test("the replay failure messages name no vendor host", () => {
    const naming = Object.entries(REPLAY_FAILURE_MESSAGES)
      .filter(([, message]) => VENDOR_HOST.test(message))
      .map(([code, message]) => `${code}: ${JSON.stringify(message)}`);

    if (naming.length > 0) {
      throw new Error(
        `${naming.length} replay failure message(s) name a vendor host. Plain English in ` +
          `anything a customer reads, and never another vendor's address: it sends them to a ` +
          `product this installation may not even use, and it is an id from somewhere we do not ` +
          `own. Say what to do, not where someone else keeps it. Offenders:\n  ` +
          `${naming.join("\n  ")}`,
      );
    }
    expect(naming).toEqual([]);
  });
});
