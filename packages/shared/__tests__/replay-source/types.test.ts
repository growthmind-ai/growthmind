import { describe, expect, test } from "bun:test";

import {
  replayEventsResultSchema,
  replayEventsStopSchema,
  replayFailureCodeSchema,
  replayListResultSchema,
  replayRecordingSummarySchema,
  replaySourceKindSchema,
  replaySourceValidationSchema,
  rrwebEventSchema,
} from "../../src/replay-source/types";
import { sessionSourceValidationSchema } from "../../src/session-source/types";

const VALID_EVENT = { type: 3, timestamp: 1722770000000, data: {} };

const VALID_RECORDING = {
  recordingId: "rec_01",
  startedAt: null,
  lastActivityAt: null,
  meta: {},
};

const TELEMETRY = { pagesFetched: 1, droppedMalformed: 0, eventsReceived: 4 };

const FAILURE = { code: "unreachable", message: "The recording source could not be reached." };

describe("rrwebEventSchema", () => {
  test("accepts a well-formed rrweb event", () => {
    expect(rrwebEventSchema.safeParse(VALID_EVENT).success).toBe(true);
  });

  test("rejects a negative event type", () => {
    expect(rrwebEventSchema.safeParse({ ...VALID_EVENT, type: -1 }).success).toBe(false);
  });

  test("rejects a non-integer event type", () => {
    expect(rrwebEventSchema.safeParse({ ...VALID_EVENT, type: 3.5 }).success).toBe(false);
  });

  test("rejects a non-finite timestamp", () => {
    expect(
      rrwebEventSchema.safeParse({ ...VALID_EVENT, timestamp: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
  });

  test("rejects a zero timestamp", () => {
    expect(rrwebEventSchema.safeParse({ ...VALID_EVENT, timestamp: 0 }).success).toBe(false);
  });

  test("rejects a negative timestamp", () => {
    expect(rrwebEventSchema.safeParse({ ...VALID_EVENT, timestamp: -1722770000000 }).success).toBe(
      false,
    );
  });

  test("rejects an event with no data key at all", () => {
    expect(rrwebEventSchema.safeParse({ type: 3, timestamp: 1722770000000 }).success).toBe(false);
  });
});

describe("replayFailureCodeSchema", () => {
  test("its options are exactly the six documented failure codes, nothing more or fewer", () => {
    expect(replayFailureCodeSchema.options.toSorted()).toEqual(
      (
        [
          "invalid_credentials",
          "missing_read_scope",
          "recording_not_found",
          "unreachable",
          "rate_limited",
          "misconfigured",
        ] as const
      ).toSorted(),
    );
  });

  test("rejects a code that is not in the enum", () => {
    expect(replayFailureCodeSchema.safeParse("timeout").success).toBe(false);
  });
});

describe("replaySourceKindSchema", () => {
  test('its options are exactly ["rrweb"]', () => {
    expect(replaySourceKindSchema.options).toEqual(["rrweb"]);
  });

  test('rejects a session-source kind such as "posthog"', () => {
    expect(replaySourceKindSchema.safeParse("posthog").success).toBe(false);
  });
});

describe("replayRecordingSummarySchema", () => {
  test("accepts a recording with nullable timestamps and an empty meta record", () => {
    expect(replayRecordingSummarySchema.safeParse(VALID_RECORDING).success).toBe(true);
  });

  test("rejects an empty recordingId", () => {
    expect(
      replayRecordingSummarySchema.safeParse({ ...VALID_RECORDING, recordingId: "" }).success,
    ).toBe(false);
  });

  test("accepts a Date for startedAt and null for lastActivityAt", () => {
    expect(
      replayRecordingSummarySchema.safeParse({
        ...VALID_RECORDING,
        startedAt: new Date("2026-08-04T00:00:00Z"),
      }).success,
    ).toBe(true);
  });

  test("rejects a string in place of a startedAt date", () => {
    expect(
      replayRecordingSummarySchema.safeParse({ ...VALID_RECORDING, startedAt: "2026-08-04" })
        .success,
    ).toBe(false);
  });

  test("accepts arbitrary unknown values inside meta", () => {
    expect(
      replayRecordingSummarySchema.safeParse({
        ...VALID_RECORDING,
        meta: { region: "us", retries: 2, nested: { ok: true } },
      }).success,
    ).toBe(true);
  });
});

describe("replayListResultSchema", () => {
  test("accepts an ok result that stopped on the watermark", () => {
    const result = {
      ok: true,
      recordings: [VALID_RECORDING],
      stop: "watermark",
      resumeCursor: null,
      ...TELEMETRY,
    };
    expect(replayListResultSchema.safeParse(result).success).toBe(true);
  });

  test("accepts an ok result that stopped on the page cap with a resume cursor", () => {
    const result = {
      ok: true,
      recordings: [],
      stop: "page_cap",
      resumeCursor: "cursor-123",
      ...TELEMETRY,
    };
    expect(replayListResultSchema.safeParse(result).success).toBe(true);
  });

  test("rejects a stop value outside watermark, page_cap, exhausted", () => {
    const result = { ok: true, recordings: [], stop: "done", resumeCursor: null, ...TELEMETRY };
    expect(replayListResultSchema.safeParse(result).success).toBe(false);
  });

  test("accepts a failure result carrying partial recordings and telemetry", () => {
    const result = {
      ok: false,
      failure: FAILURE,
      partialRecordings: [VALID_RECORDING],
      ...TELEMETRY,
    };
    expect(replayListResultSchema.safeParse(result).success).toBe(true);
  });

  test("rejects negative telemetry on the ok arm", () => {
    const result = {
      ok: true,
      recordings: [],
      stop: "exhausted",
      resumeCursor: null,
      ...TELEMETRY,
      droppedMalformed: -1,
    };
    expect(replayListResultSchema.safeParse(result).success).toBe(false);
  });

  test("rejects negative telemetry on the failure arm", () => {
    const result = {
      ok: false,
      failure: FAILURE,
      partialRecordings: [],
      ...TELEMETRY,
      pagesFetched: -3,
    };
    expect(replayListResultSchema.safeParse(result).success).toBe(false);
  });

  test("rejects an ok result missing its recordings array", () => {
    const result = { ok: true, stop: "watermark", resumeCursor: null, ...TELEMETRY };
    expect(replayListResultSchema.safeParse(result).success).toBe(false);
  });

  test("rejects a failure result missing its failure field", () => {
    const result = { ok: false, partialRecordings: [], ...TELEMETRY };
    expect(replayListResultSchema.safeParse(result).success).toBe(false);
  });
});

describe("replayEventsStopSchema", () => {
  test("its options are exactly page_cap and exhausted, no watermark", () => {
    expect(replayEventsStopSchema.options.toSorted()).toEqual(
      (["page_cap", "exhausted"] as const).toSorted(),
    );
  });

  test("rejects watermark, which is a listRecordings-only stop reason", () => {
    expect(replayEventsStopSchema.safeParse("watermark").success).toBe(false);
  });
});

describe("replayEventsResultSchema", () => {
  test("accepts an ok result that exhausted its pages with a null resumeCursor", () => {
    const result = {
      ok: true,
      events: [VALID_EVENT],
      stop: "exhausted",
      resumeCursor: null,
      ...TELEMETRY,
    };
    expect(replayEventsResultSchema.safeParse(result).success).toBe(true);
  });

  test("accepts an ok result that stopped on the page cap with a resume cursor", () => {
    const result = {
      ok: true,
      events: [],
      stop: "page_cap",
      resumeCursor: "cursor-123",
      ...TELEMETRY,
    };
    expect(replayEventsResultSchema.safeParse(result).success).toBe(true);
  });

  test("accepts an ok result with zero events", () => {
    const result = { ok: true, events: [], stop: "exhausted", resumeCursor: null, ...TELEMETRY };
    expect(replayEventsResultSchema.safeParse(result).success).toBe(true);
  });

  test("accepts a failure result carrying partial events and telemetry", () => {
    const result = { ok: false, failure: FAILURE, partialEvents: [VALID_EVENT], ...TELEMETRY };
    expect(replayEventsResultSchema.safeParse(result).success).toBe(true);
  });

  test("rejects an ok result missing its stop field", () => {
    const result = { ok: true, events: [], resumeCursor: null, ...TELEMETRY };
    expect(replayEventsResultSchema.safeParse(result).success).toBe(false);
  });

  test("rejects an ok result with a watermark stop, which pullEvents never produces", () => {
    const result = {
      ok: true,
      events: [],
      stop: "watermark",
      resumeCursor: null,
      ...TELEMETRY,
    };
    expect(replayEventsResultSchema.safeParse(result).success).toBe(false);
  });

  test("rejects negative telemetry on the ok arm", () => {
    const result = {
      ok: true,
      events: [],
      stop: "exhausted",
      resumeCursor: null,
      ...TELEMETRY,
      eventsReceived: -1,
    };
    expect(replayEventsResultSchema.safeParse(result).success).toBe(false);
  });

  test("rejects an ok result whose events array contains a malformed event", () => {
    const result = {
      ok: true,
      events: [{ ...VALID_EVENT, type: -1 }],
      stop: "exhausted",
      resumeCursor: null,
      ...TELEMETRY,
    };
    expect(replayEventsResultSchema.safeParse(result).success).toBe(false);
  });

  test("rejects a failure result missing its partialEvents field", () => {
    const result = { ok: false, failure: FAILURE, ...TELEMETRY };
    expect(replayEventsResultSchema.safeParse(result).success).toBe(false);
  });
});

describe("replaySourceValidationSchema", () => {
  test("accepts an ok validation with just ok and checkedAt", () => {
    const result = { ok: true, checkedAt: new Date() };
    expect(replaySourceValidationSchema.safeParse(result).success).toBe(true);
  });

  test("accepts a failed validation carrying a failure code and message", () => {
    const result = { ok: false, checkedAt: new Date(), failure: FAILURE };
    expect(replaySourceValidationSchema.safeParse(result).success).toBe(true);
  });

  test("rejects a failed validation with no failure field", () => {
    const result = { ok: false, checkedAt: new Date() };
    expect(replaySourceValidationSchema.safeParse(result).success).toBe(false);
  });

  test("mirrors sessionSourceValidationSchema's discriminated-union shape field-for-field", () => {
    const [replayOk, replayFail] = replaySourceValidationSchema.options;
    const [sessionOk, sessionFail] = sessionSourceValidationSchema.options;

    expect(Object.keys(replayOk.shape).toSorted()).toEqual(Object.keys(sessionOk.shape).toSorted());
    expect(Object.keys(replayFail.shape).toSorted()).toEqual(
      Object.keys(sessionFail.shape).toSorted(),
    );
  });
});
