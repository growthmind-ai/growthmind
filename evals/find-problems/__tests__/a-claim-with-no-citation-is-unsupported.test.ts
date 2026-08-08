import { describe, expect, it } from "bun:test";

import { assessProblems, isCitationCheckable, statedOutOf } from "../src/analyse/support";
import type { ProposedProblem, SessionSummary } from "../src/analyse/types";

const SESSIONS: readonly SessionSummary[] = [
  {
    sessionId: "s-one",
    outcome: "gave_up",
    pages: [],
    urlTrail: ["/sign-in"],
    durationMs: 1000,
    counts: {
      clicks: 1,
      deadClicks: 0,
      rageClicks: 0,
      refocuses: 0,
      abandonedFields: 0,
      scrollBacks: 0,
    },
    beats: [
      { index: 1, line: "0:00  opened /sign-in" },
      { index: 2, line: "0:02  clicked button Sign in" },
    ],
    consoleErrorCount: 0,
    consoleErrors: [],
    exitReason: null,
  },
];

function claim(overrides: Partial<ProposedProblem>): ProposedProblem {
  return {
    title: "A claim",
    whatWasSeen: "Something happened.",
    sessionsAffected: 1,
    citations: [{ sessionId: "s-one", beat: 2, quote: "clicked button Sign in" }],
    recommendation: { action: "Change it", whereInProduct: "/sign-in", whyItHelps: "" },
    ...overrides,
  };
}

describe("a claim is only supported when its citations can be checked", () => {
  it("marks a claim with no citations at all as unsupported and keeps it", () => {
    const [assessed] = assessProblems([claim({ citations: [] })], SESSIONS);

    expect(assessed?.support).toBe("unsupported");
    expect(assessed?.validCitations).toBe(0);
  });

  it("marks a claim citing a session that is not in the corpus as unsupported", () => {
    const [assessed] = assessProblems(
      [claim({ citations: [{ sessionId: "s-nine", beat: 1, quote: "invented" }] })],
      SESSIONS,
    );

    expect(assessed?.support).toBe("unsupported");
    expect(assessed?.invalidCitations).toBe(1);
  });

  it("marks a claim quoting words that are not that beat's as unsupported", () => {
    const [assessed] = assessProblems(
      [
        claim({
          citations: [
            { sessionId: "s-one", beat: 2, quote: "error: Failed to load resource, status 401" },
          ],
        }),
      ],
      SESSIONS,
    );

    expect(assessed?.support).toBe("unsupported");
    expect(assessed?.invalidCitations).toBe(1);
  });

  it("accepts a quote that is the beat's own words with the timestamp left off", () => {
    const [assessed] = assessProblems(
      [claim({ citations: [{ sessionId: "s-one", beat: 2, quote: "clicked button Sign in" }] })],
      SESSIONS,
    );

    expect(assessed?.support).toBe("cited");
  });

  it("marks an empty quote as no citation at all", () => {
    const [assessed] = assessProblems(
      [claim({ citations: [{ sessionId: "s-one", beat: 2, quote: "  " }] })],
      SESSIONS,
    );

    expect(assessed?.support).toBe("unsupported");
  });

  it("marks a claim citing a beat that session does not have as unsupported", () => {
    const [assessed] = assessProblems(
      [claim({ citations: [{ sessionId: "s-one", beat: 99, quote: "invented" }] })],
      SESSIONS,
    );

    expect(assessed?.support).toBe("unsupported");
    expect(assessed?.invalidCitations).toBe(1);
  });

  it("marks a claim with one checkable citation as cited even when another is bad", () => {
    const [assessed] = assessProblems(
      [
        claim({
          citations: [
            { sessionId: "s-one", beat: 1, quote: "opened /sign-in" },
            { sessionId: "s-nine", beat: 1, quote: "invented" },
          ],
        }),
      ],
      SESSIONS,
    );

    expect(assessed?.support).toBe("cited");
    expect(assessed?.validCitations).toBe(1);
    expect(assessed?.invalidCitations).toBe(1);
  });

  it("carries the corpus size on every claim so a number can never appear alone", () => {
    const [assessed] = assessProblems([claim({ sessionsAffected: 1 })], SESSIONS);

    expect(assessed?.sessionsTotal).toBe(SESSIONS.length);
    expect(statedOutOf(assessed!)).toBe("1 of 1 sessions");
  });

  it("flags a claim counting more sessions than the corpus holds", () => {
    const [assessed] = assessProblems([claim({ sessionsAffected: 7 })], SESSIONS);

    expect(assessed?.claimedMoreThanCorpus).toBe(true);
  });

  it("treats an empty corpus as making every citation uncheckable", () => {
    expect(isCitationCheckable({ sessionId: "s-one", beat: 1, quote: "x" }, [])).toBe(false);
  });
});
