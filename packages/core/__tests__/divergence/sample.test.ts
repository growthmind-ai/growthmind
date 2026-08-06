import { describe, expect, test } from "bun:test";

import type { SessionTimeline } from "../../src/detect/types";
import { sampleSessionIds } from "../../src/divergence/sample";
import { sessionOf } from "../spine/fixtures";

const ORIGIN = "/pricing";
const LIMIT = 50;
const COHORT_SIZE = 120;
const BUCKET_SIZE = 3;

function buildCohort(): readonly SessionTimeline[] {
  const sessions: SessionTimeline[] = [];

  for (let index = 0; index < COHORT_SIZE; index += 1) {
    const bucket = Math.floor(index / BUCKET_SIZE);
    const startedAt = new Date(Date.UTC(2026, 0, 1, 0, bucket, 0));
    // Reverse each bucket's slot so a fixture's array order never already matches the
    // expected startedAt order — the sessionId tie-break has to do real work at rank 50.
    const slot = BUCKET_SIZE - 1 - (index % BUCKET_SIZE);
    const sessionId = `s${String(bucket).padStart(3, "0")}-${String(slot).padStart(2, "0")}`;

    sessions.push({ ...sessionOf(sessionId, [ORIGIN]), startedAt });
  }

  return sessions;
}

function expectedOrder(sessions: readonly SessionTimeline[], limit: number): readonly string[] {
  return sessions
    .toSorted((left, right) => {
      const byStartedAt = left.startedAt.getTime() - right.startedAt.getTime();
      if (byStartedAt !== 0) return byStartedAt;
      if (left.sessionId < right.sessionId) return -1;
      if (left.sessionId > right.sessionId) return 1;
      return 0;
    })
    .slice(0, limit)
    .map((session) => session.sessionId);
}

describe("sampleSessionIds", () => {
  test("samples session ids deterministically, earliest-started-first, capped at the limit", () => {
    const cohort = buildCohort();
    const shuffled = cohort.toReversed();

    const sampled = sampleSessionIds(shuffled, LIMIT);

    expect(sampled).toHaveLength(LIMIT);
    expect(sampled).toEqual(expectedOrder(cohort, LIMIT));

    const sampledAgain = sampleSessionIds(shuffled, LIMIT);
    expect(sampledAgain).toEqual(sampled);
  });
});
