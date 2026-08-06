// Nothing under `@/lib/replay/summary-story` exists yet (ADD o-047 AD-4) — this file is
// Wave 0's red baseline for the six-arm union and the resolver that derives it.
import { readFindingText, RETRYABLE_PULL_STOP, type TranscriptPullStop } from "@growthmind/db";
import { scannedTextFor } from "@growthmind/db/testing";
import { describe, expect, test } from "bun:test";

import {
  resolveRecordingSummaryStory,
  type RecordingSummaryFacts,
  type RecordingSummaryRead,
} from "@/lib/replay/summary-story";

const HEADLINE = "Someone abandoned checkout after the card form errored";
const CONTEXT = ["They opened /pricing, moved to /checkout, and left on the payment step."];

// Built through `reviewFindingText`, so the branded text the resolver reads is the value the
// repository actually hands it rather than a cast that never met the scan.
const CLEAN_TEXT = { held: false as const, ...scannedTextFor(HEADLINE, CONTEXT) };
const NO_CONTEXT_TEXT = { held: false as const, ...scannedTextFor(HEADLINE, []) };
const HELD_TEXT = readFindingText({ headline: HEADLINE, context: 42 });

const VENDOR_REASON = "PostHog 429: rate limited (req_ab12)";
const VENDOR_ID = "req_ab12";

const CAPPED_STOPS = [
  "exhausted",
  "page_cap",
  "byte_cap",
] as const satisfies readonly TranscriptPullStop[];

const RESOLVED_FIELDS = ["kind", "headline", "context", "summarySource", "partial"];

function factsFor(overrides: Partial<RecordingSummaryFacts> = {}): RecordingSummaryFacts {
  return { text: CLEAN_TEXT, summarySource: "model_rendered", pullStop: null, ...overrides };
}

function rowRead(record: RecordingSummaryFacts): RecordingSummaryRead {
  return { kind: "row", record };
}

// Loud rather than optional-chained: a wrong arm here means the ordering under test broke, and
// a silent `undefined.partial` would read as a passing assertion about nothing.
function resolvedFor(read: RecordingSummaryRead) {
  const story = resolveRecordingSummaryStory(read);
  if (story.kind !== "resolved") {
    throw new Error(`expected a resolved story, the resolver returned ${story.kind}`);
  }
  return story;
}

describe("resolveRecordingSummaryStory", () => {
  test("should report read_failed when the summary read threw", () => {
    expect(resolveRecordingSummaryStory({ kind: "read_failed" })).toEqual({ kind: "read_failed" });
  });

  test("should report queued when there is no row and the source is ready", () => {
    expect(resolveRecordingSummaryStory({ kind: "no_row", source: "ready" })).toEqual({
      kind: "queued",
    });
  });

  test("should report no_source when the source has no connection", () => {
    expect(resolveRecordingSummaryStory({ kind: "no_row", source: "no_connection" })).toEqual({
      kind: "no_source",
    });
  });

  test("should fold an unreadable credential into no_source", () => {
    expect(
      resolveRecordingSummaryStory({ kind: "no_row", source: "unreadable_credential" }),
    ).toEqual({ kind: "no_source" });
  });

  // A `/settings` link cannot fix a self-hosted install with no key, so this state must never
  // collapse into the one that offers it.
  test("should keep not_configured as its own state", () => {
    expect(resolveRecordingSummaryStory({ kind: "no_row", source: "not_configured" })).toEqual({
      kind: "not_configured",
    });
  });

  test("should report held before it considers a partial pull", () => {
    const story = resolveRecordingSummaryStory(
      rowRead(factsFor({ text: HELD_TEXT, pullStop: RETRYABLE_PULL_STOP })),
    );

    expect(story).toEqual({ kind: "held" });
  });

  test("should mark a failed pull as partial", () => {
    const story = resolvedFor(rowRead(factsFor({ pullStop: RETRYABLE_PULL_STOP })));

    expect(story).toEqual({
      kind: "resolved",
      headline: CLEAN_TEXT.headline,
      context: CLEAN_TEXT.context,
      summarySource: "model_rendered",
      partial: true,
    });
  });

  test("should not mark a clean pull as partial", () => {
    expect(resolvedFor(rowRead(factsFor({ pullStop: null }))).partial).toBe(false);
  });

  // A cap is a bound reached, not a failure: the pull read every byte it was allowed to.
  test("should not mark a capped pull as partial", () => {
    const verdicts = CAPPED_STOPS.map((pullStop) => ({
      pullStop,
      partial: resolvedFor(rowRead(factsFor({ pullStop }))).partial,
    }));

    expect(verdicts).toEqual(CAPPED_STOPS.map((pullStop) => ({ pullStop, partial: false })));
  });

  test("should resolve a row with no context lines", () => {
    const story = resolvedFor(rowRead(factsFor({ text: NO_CONTEXT_TEXT })));

    expect(story).toEqual({
      kind: "resolved",
      headline: NO_CONTEXT_TEXT.headline,
      context: [],
      summarySource: "model_rendered",
      partial: false,
    });
  });

  test("should carry no field a vendor string could reach", () => {
    const record = { ...factsFor({ pullStop: RETRYABLE_PULL_STOP }), pullReason: VENDOR_REASON };

    const story = resolvedFor({ kind: "row", record });

    expect(JSON.stringify(story)).not.toContain(VENDOR_ID);
    expect(Object.keys(story)).toEqual(RESOLVED_FIELDS);
  });

  // D4: the story is derived from the row alone, so a missed or late publish can only delay the
  // refresh, never leave the card showing a state the database has already left.
  test("should be a pure function of persisted state", () => {
    const read = rowRead(factsFor());

    expect(resolveRecordingSummaryStory.length).toBe(1);
    expect(resolveRecordingSummaryStory(read)).toEqual(resolveRecordingSummaryStory(read));
    expect(resolveRecordingSummaryStory(read).kind).toBe("resolved");
  });
});
