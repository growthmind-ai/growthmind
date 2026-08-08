import { describe, expect, test } from "bun:test";

import {
  NARRATION_MAX_ACTIONS,
  compactTranscript,
  countNotable,
  describeSessionDuration,
  narrationOutputSchema,
  renderDigest,
  renderRecordingFloor,
  renderWithheldRecordingFloor,
  resumeDigest,
  type HeldTranscript,
} from "../../src/replay/narration";
import {
  PERSISTED_TRANSCRIPT_VERSION,
  serialisePersistedTranscript,
} from "../../src/replay/persisted-transcript";
import type { SessionAction, SessionTranscript } from "../../src/replay/types";

const ELEMENT = {
  nodeId: 7,
  tagName: "button",
  classes: ["submitButton"],
  attributes: {},
} as const;

function click(atMs: number): SessionAction {
  return { kind: "click", atMs, element: ELEMENT };
}

function rage(atMs: number): SessionAction {
  return { kind: "rage_click", atMs, element: ELEMENT, clicks: 4, spanMs: 900 };
}

function page(atMs: number, href: string): SessionAction {
  return { kind: "page", atMs, href };
}

function transcriptOf(actions: readonly SessionAction[]): SessionTranscript {
  return {
    actions,
    startedAt: new Date("2026-08-05T10:00:00.000Z"),
    durationMs: 60_000,
    pages: actions.flatMap((action) =>
      action.kind === "page" && action.href !== undefined ? [action.href] : [],
    ),
    counts: {
      clicks: actions.filter((action) => action.kind === "click").length,
      deadClicks: 0,
      rageClicks: actions.filter((action) => action.kind === "rage_click").length,
      refocuses: 0,
      abandonedFields: 0,
      scrollBacks: 0,
    },
    droppedEvents: 0,
    clockOriginAtMs: null,
  };
}

describe("compactTranscript — a session under budget is passed through whole", () => {
  test("every action survives and nothing is reported omitted", () => {
    const transcript = transcriptOf([page(0, "/pricing"), click(1_000), click(2_000)]);

    const digest = compactTranscript(transcript);

    expect(digest.actions).toHaveLength(3);
    expect(digest.omitted).toBe(0);
  });

  test("an empty session produces an empty digest rather than throwing", () => {
    const digest = compactTranscript(transcriptOf([]));

    expect(digest.actions).toHaveLength(0);
    expect(digest.omitted).toBe(0);
    expect(renderDigest(digest)).toBe("(nothing recorded)");
  });
});

describe("compactTranscript — over budget, priority beats position", () => {
  test("a rage click at the very end survives a budget spent on earlier clicks", () => {
    const ordinary = Array.from({ length: 200 }, (_, index) => click(index * 100));
    const transcript = transcriptOf([...ordinary, rage(999_000)]);

    const digest = compactTranscript(transcript, 10);

    expect(digest.actions).toHaveLength(10);
    expect(digest.actions.some((action) => action.kind === "rage_click")).toBe(true);
    expect(digest.omitted).toBe(191);
  });

  test("navigations survive so the pages the person visited are never lost", () => {
    const ordinary = Array.from({ length: 100 }, (_, index) => click(index * 100));
    const transcript = transcriptOf([...ordinary, page(500_000, "/settings")]);

    const digest = compactTranscript(transcript, 5);

    expect(digest.actions.some((action) => action.kind === "page")).toBe(true);
  });

  test("the kept actions stay in the order they happened", () => {
    const transcript = transcriptOf([page(0, "/a"), click(1_000), rage(2_000), click(3_000)]);

    const digest = compactTranscript(transcript, 3);
    const stamps = digest.actions.map((action) => action.atMs);

    expect(stamps).toEqual(stamps.toSorted((left, right) => left - right));
  });

  test("more notable actions than budget still yields exactly the budget", () => {
    const transcript = transcriptOf(Array.from({ length: 50 }, (_, index) => rage(index * 100)));

    const digest = compactTranscript(transcript, 4);

    expect(digest.actions).toHaveLength(4);
    expect(digest.omitted).toBe(46);
  });

  test("a zero budget keeps nothing and counts everything as omitted", () => {
    const transcript = transcriptOf([click(0), rage(1_000)]);

    const digest = compactTranscript(transcript, 0);

    expect(digest.actions).toHaveLength(0);
    expect(digest.omitted).toBe(2);
  });
});

describe("renderDigest — what the model is given to read", () => {
  test("omitted actions are declared, never silently dropped", () => {
    const transcript = transcriptOf(Array.from({ length: 40 }, (_, index) => click(index * 100)));

    const rendered = renderDigest(compactTranscript(transcript, 5));

    expect(rendered).toContain("35 further actions not shown");
  });

  test("a whole session says nothing about omissions", () => {
    const rendered = renderDigest(compactTranscript(transcriptOf([click(0)])));

    expect(rendered).not.toContain("not shown");
  });

  test("malformed events dropped upstream stay visible in the digest", () => {
    const transcript = { ...transcriptOf([click(0)]), droppedEvents: 12 };

    expect(renderDigest(compactTranscript(transcript))).toContain("12 malformed events dropped");
  });
});

describe("narrationOutputSchema — the shape the model must return", () => {
  test("a headline and context are both required and non-empty", () => {
    expect(narrationOutputSchema.safeParse({ headline: "a", context: "b" }).success).toBe(true);
    expect(narrationOutputSchema.safeParse({ headline: "", context: "b" }).success).toBe(false);
    expect(narrationOutputSchema.safeParse({ headline: "a" }).success).toBe(false);
  });

  test("extra keys are refused, so a drifting model output cannot be persisted", () => {
    const parsed = narrationOutputSchema.safeParse({
      headline: "a",
      context: "b",
      confidence: "high",
    });

    expect(parsed.success).toBe(false);
  });
});

describe("renderRecordingFloor — a summary exists even when no model ran", () => {
  test("it names the duration and the single page the person stayed on", () => {
    const digest = compactTranscript(transcriptOf([page(0, "/pricing"), click(1_000)]));

    const floor = renderRecordingFloor(digest);

    expect(floor.headline).toContain("1m 0s");
    expect(floor.context).toContain("They stayed on /pricing.");
  });

  test("several pages are counted rather than listed", () => {
    const digest = compactTranscript(
      transcriptOf([page(0, "/a"), page(1_000, "/b"), page(2_000, "/c")]),
    );

    expect(renderRecordingFloor(digest).context).toContain("They moved through 3 pages.");
  });

  test("a session with no recorded page says so instead of naming none", () => {
    const digest = compactTranscript(transcriptOf([click(0)]));

    expect(renderRecordingFloor(digest).context).toContain("No page address was recorded.");
  });

  test("notable behaviour appears in the floor, so it survives a model failure", () => {
    const digest = compactTranscript(transcriptOf([page(0, "/buy"), rage(1_000), rage(2_000)]));

    const context = renderRecordingFloor(digest).context.join(" ");

    expect(context).toContain("pressed the same thing repeatedly 2 times");
  });

  test("an empty recording says nothing was recorded rather than inventing a session", () => {
    const floor = renderRecordingFloor(compactTranscript(transcriptOf([])));

    expect(floor.context).toEqual(["Nothing was recorded in this session."]);
  });

  test("counts that are zero produce no sentence at all", () => {
    const digest = compactTranscript(transcriptOf([page(0, "/a")]));

    const context = renderRecordingFloor(digest).context.join(" ");

    expect(context).not.toContain("0 times");
    expect(context).not.toContain("clicked");
  });
});

describe("renderWithheldRecordingFloor — the rung that cannot itself be withheld", () => {
  test("it is built from constants alone, so no recorded value can reach it", () => {
    const withheld = renderWithheldRecordingFloor();

    expect(withheld.headline).toBe("A session was recorded here.");
    expect(withheld.context).toHaveLength(1);
  });

  test("it names no page, no count and no duration", () => {
    const text = [
      renderWithheldRecordingFloor().headline,
      ...renderWithheldRecordingFloor().context,
    ].join(" ");

    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain("/");
  });
});

describe("countNotable", () => {
  test("counts only the actions a session is worth reading for", () => {
    expect(countNotable([click(0), rage(1_000), page(2_000, "/a")])).toBe(1);
    expect(countNotable([])).toBe(0);
  });
});

describe("describeSessionDuration", () => {
  test("reads in seconds under a minute and minutes above it", () => {
    expect(describeSessionDuration(42_000)).toBe("42s");
    expect(describeSessionDuration(92_000)).toBe("1m 32s");
  });

  test("never reads negative", () => {
    expect(describeSessionDuration(-1_000)).toBe("0s");
  });
});

describe("the budget constant", () => {
  test("is a positive bound, because the whole point is that a session is not small", () => {
    expect(NARRATION_MAX_ACTIONS).toBeGreaterThan(0);
  });
});

function heldFrom(
  actions: readonly SessionAction[],
  clockOriginAtMs: number | null = null,
): HeldTranscript {
  const persisted = serialisePersistedTranscript(actions, PERSISTED_TRANSCRIPT_VERSION);

  return {
    actions: persisted.actions,
    omitted: 0,
    pages: actions.flatMap((action) =>
      action.kind === "page" && action.href !== undefined ? [action.href] : [],
    ),
    durationMs: 1_000,
    droppedEvents: 0,
    clockOriginAtMs,
  };
}

function emptyContinuation(): SessionTranscript {
  return transcriptOf([]);
}

describe("resumeDigest — a held row continued by the pull that resumed it", () => {
  test("should place the pulled continuation after the held beats, on the pulled clock", () => {
    const held = heldFrom([page(0, "/pricing"), click(1_000)]);
    const pulled = transcriptOf([click(1_500), click(2_000)]);

    const { walk } = resumeDigest(held, pulled);

    expect(walk.actions.map((action) => action.kind)).toEqual(["page", "click", "click", "click"]);
    expect(walk.actions.map((action) => action.atMs)).toEqual([0, 1_000, 1_500, 2_000]);
  });

  test("should drop the held row's trailing 'ended' marker before continuing the walk", () => {
    const held = heldFrom([click(0), { kind: "ended", atMs: 5_000 }]);
    const pulled = transcriptOf([click(5_500)]);

    const { walk } = resumeDigest(held, pulled);

    expect(walk.actions.map((action) => action.kind)).toEqual(["click", "click"]);
  });

  test("should carry the held row's omitted count forward into the resumed digest", () => {
    const held: HeldTranscript = { ...heldFrom([click(0)]), omitted: 3 };
    const pulled = transcriptOf([click(1_000)]);

    const { digest } = resumeDigest(held, pulled);

    expect(digest.omitted).toBeGreaterThanOrEqual(3);
  });

  test("should union held and pulled pages without duplicating one both sides visited", () => {
    const held = heldFrom([page(0, "/pricing")]);
    const pulled = transcriptOf([page(1_000, "/pricing"), page(2_000, "/checkout")]);

    const { walk } = resumeDigest(held, pulled);

    expect(walk.pages).toEqual(["/pricing", "/checkout"]);
  });

  test("should keep the held row's clock origin when a rate-limited continuation reads nothing", () => {
    const held = heldFrom([click(0)], 1_700_000_000_000);

    const { walk } = resumeDigest(held, emptyContinuation());

    expect(walk.clockOriginAtMs).toBe(1_700_000_000_000);
  });

  test("should prefer the continuation's own origin when it read something", () => {
    const held = heldFrom([click(0)], 1_700_000_000_000);
    const pulled = { ...transcriptOf([click(500)]), clockOriginAtMs: 1_700_000_500_000 };

    const { walk } = resumeDigest(held, pulled);

    expect(walk.clockOriginAtMs).toBe(1_700_000_500_000);
  });
});
