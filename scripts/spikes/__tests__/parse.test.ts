// Wave 1 red tests for scripts/spikes/lib/parse.ts (add retrievability, fail
// directions). These tests define the response fixture shapes the Wave 2 implementer
// must parse. The fixtures below are the contract.
//
// Fixture shapes (authoritative for state.md):
// Events list (`GET /api/projects/:id/events`): { results: [{ id, event, distinct_id,
//  properties: { gm_spike_marker }, timestamp }], next: null }
// HogQL query (`POST /api/projects/:id/query`), where the harness SELECTs `event,
//  distinct_id, properties.gm_spike_marker`: { columns: ["event", "distinct_id",
//  "properties.gm_spike_marker"],
//  results: [[event, distinct_id, marker],...] }
// Recordings list (`GET /api/projects/:id/session_recordings`): { results: [{ id,
//  distinct_id, start_time, recording_duration }], has_next: false }

import { describe, expect, test } from "bun:test";

import type { CandidateEvent, CandidateRecording } from "../lib/parse";
import {
  matchesMarker,
  parseEventsResponse,
  parseQueryResponse,
  parseRecordingsResponse,
} from "../lib/parse";
import { EVENT_NAMES, MARKER_PROP } from "../lib/constants";

const MARKER_A = "11111111-aaaa-4aaa-8aaa-111111111111";
const MARKER_B = "22222222-bbbb-4bbb-8bbb-222222222222";
const MARKER_C = "33333333-cccc-4ccc-8ccc-333333333333";

/** Well-formed events list API body (primary endpoint). */
function eventsBody(marker: string): unknown {
  return {
    results: [
      {
        id: "0198f0a2-5b1e-7000-8000-4f2a9c1d3e5b",
        event: EVENT_NAMES.customEvent,
        distinct_id: "gm-spike-user",
        properties: { [MARKER_PROP]: marker, $lib: "fetch" },
        timestamp: "2026-07-30T12:00:00.000Z",
      },
    ],
    next: null,
  };
}

/** Well-formed HogQL query API body (secondary endpoint). */
function queryBody(marker: string): unknown {
  return {
    columns: ["event", "distinct_id", `properties.${MARKER_PROP}`],
    results: [[EVENT_NAMES.customEvent, "gm-spike-user", marker]],
  };
}

/** Well-formed session_recordings list API body (recording leg). */
function recordingsBody(distinctId: string): unknown {
  return {
    results: [
      {
        id: "0198f0a2-6c2f-7000-8000-5a3b0d2e4f6c",
        distinct_id: distinctId,
        start_time: "2026-07-30T12:00:05.000Z",
        recording_duration: 12,
      },
    ],
    has_next: false,
  };
}

describe("parseEventsResponse", () => {
  test("should parse a well-formed events response into candidate events", () => {
    const result = parseEventsResponse(eventsBody(MARKER_A));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected ok, got failure: ${result.reason}`);
    expect(result.value).toHaveLength(1);
    const candidate = result.value[0];
    expect(candidate?.event).toBe(EVENT_NAMES.customEvent);
    expect(candidate?.properties[MARKER_PROP]).toBe(MARKER_A);
  });

  test("should return a named parse failure for a missing-field response, not throw", () => {
    expect(() => parseEventsResponse({})).not.toThrow();
    expect(() => parseEventsResponse({ results: "nope" })).not.toThrow();
    expect(() => parseEventsResponse({ results: [{ id: "x", event: "y" }] })).not.toThrow();

    const missingResults = parseEventsResponse({});
    expect(missingResults.ok).toBe(false);
    if (missingResults.ok) throw new Error("expected failure for {}");
    expect(missingResults.reason.length).toBeGreaterThan(0);

    const wrongResultsType = parseEventsResponse({ results: "nope" });
    expect(wrongResultsType.ok).toBe(false);
    if (wrongResultsType.ok) throw new Error("expected failure for non-array results");
    expect(wrongResultsType.reason.length).toBeGreaterThan(0);

    const entryMissingProperties = parseEventsResponse({
      results: [{ id: "x", event: "y", distinct_id: "z", timestamp: "t" }],
    });
    expect(entryMissingProperties.ok).toBe(false);
    if (entryMissingProperties.ok) {
      throw new Error("expected failure for entry missing properties");
    }
    expect(entryMissingProperties.reason.length).toBeGreaterThan(0);
  });

  test("should return an empty match (not a failure) for an empty results array", () => {
    const result = parseEventsResponse({ results: [], next: null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`empty must not be a failure: ${result.reason}`);
    expect(result.value).toHaveLength(0);
  });
});

describe("parseQueryResponse / parseRecordingsResponse", () => {
  test("should parse recordings and query responses with the same fail directions", () => {
    // HogQL query, well-formed.
    const queryOk = parseQueryResponse(queryBody(MARKER_A));
    expect(queryOk.ok).toBe(true);
    if (!queryOk.ok) throw new Error(`query well-formed failed: ${queryOk.reason}`);
    expect(queryOk.value).toHaveLength(1);
    expect(queryOk.value[0]?.event).toBe(EVENT_NAMES.customEvent);
    expect(queryOk.value[0]?.properties[MARKER_PROP]).toBe(MARKER_A);

    // HogQL query, malformed → named failure, never a throw.
    expect(() => parseQueryResponse({})).not.toThrow();
    const queryMalformed = parseQueryResponse({ results: "nope" });
    expect(queryMalformed.ok).toBe(false);
    if (queryMalformed.ok) throw new Error("expected query failure for non-array results");
    expect(queryMalformed.reason.length).toBeGreaterThan(0);

    // HogQL query, empty → ok + empty (empty ≠ malformed).
    const queryEmpty = parseQueryResponse({
      columns: ["event", "distinct_id", `properties.${MARKER_PROP}`],
      results: [],
    });
    expect(queryEmpty.ok).toBe(true);
    if (!queryEmpty.ok) throw new Error(`query empty failed: ${queryEmpty.reason}`);
    expect(queryEmpty.value).toHaveLength(0);

    // Recordings, well-formed.
    const recOk = parseRecordingsResponse(recordingsBody(MARKER_A));
    expect(recOk.ok).toBe(true);
    if (!recOk.ok) throw new Error(`recordings well-formed failed: ${recOk.reason}`);
    expect(recOk.value).toHaveLength(1);
    expect(recOk.value[0]?.distinctId).toBe(MARKER_A);

    // Recordings, malformed → named failure, never a throw.
    expect(() => parseRecordingsResponse({})).not.toThrow();
    const recMalformed = parseRecordingsResponse({ results: "nope" });
    expect(recMalformed.ok).toBe(false);
    if (recMalformed.ok) throw new Error("expected recordings failure for non-array results");
    expect(recMalformed.reason.length).toBeGreaterThan(0);

    // Recordings, empty → ok + empty.
    const recEmpty = parseRecordingsResponse({ results: [] });
    expect(recEmpty.ok).toBe(true);
    if (!recEmpty.ok) throw new Error(`recordings empty failed: ${recEmpty.reason}`);
    expect(recEmpty.value).toHaveLength(0);
  });
});

describe("matchesMarker", () => {
  test("should not match an event with the same name but a different marker", () => {
    // The false-near-zero-latency guard: a prior trial's event with the right name must
    // never satisfy this trial's retrievability.
    const staleEvent: CandidateEvent = {
      event: EVENT_NAMES.customEvent,
      distinctId: "gm-spike-user",
      properties: { [MARKER_PROP]: MARKER_A },
    };
    expect(matchesMarker(staleEvent, MARKER_B)).toBe(false);

    const staleRecording: CandidateRecording = {
      id: "rec-prior-trial",
      distinctId: MARKER_A,
    };
    expect(matchesMarker(staleRecording, MARKER_B)).toBe(false);
  });

  test("should match only the event carrying this trial's marker property", () => {
    const candidates: readonly CandidateEvent[] = [
      {
        event: EVENT_NAMES.customEvent,
        properties: { [MARKER_PROP]: MARKER_B },
      },
      {
        event: EVENT_NAMES.customEvent,
        properties: { [MARKER_PROP]: MARKER_A },
      },
      {
        event: EVENT_NAMES.customEvent,
        properties: { [MARKER_PROP]: MARKER_C },
      },
    ];

    const matches = candidates.filter((c) => matchesMarker(c, MARKER_A));

    expect(matches).toHaveLength(1);
    expect(matches[0]?.properties[MARKER_PROP]).toBe(MARKER_A);
  });
});
