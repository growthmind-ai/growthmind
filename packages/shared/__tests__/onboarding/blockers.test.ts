// THE BLOCKER CHAIN — what the stage says before there is anything to watch.
//
// The stage moved to the top of the first-run screen. That is only an
// improvement if the panel in the best position on the page always names the
// ONE next thing, so these rows are about the sentence being present, correct
// and singular in every reachable state — not about the chain's plumbing.
//
// The last two describes are the two defects this module exists to close:
// the "Start watching" trap that shipped, and the mid-OAuth window that has no
// sentence at all on the pasted-token path.

import { describe, expect, test } from "bun:test";

import {
  canArm,
  nextBlocker,
  SETUP_BLOCKERS,
  type SetupFacts,
} from "../../src/onboarding/blockers";
import { ALL_ONBOARDING_MESSAGES } from "../../src/onboarding/messages";

/** Nothing done. The state a founder opening the product for the first time is in. */
const FRESH: SetupFacts = Object.freeze({
  analyticsAttached: false,
  workspaceAttached: false,
  deliveryResolved: false,
  armedAt: null,
});

const facts = (over: Partial<SetupFacts>): SetupFacts => ({ ...FRESH, ...over });

/** Analytics attached, nothing else. */
const READING = facts({ analyticsAttached: true });
/** A workspace connected, no channel chosen — the OAuth window. */
const MID_OAUTH = facts({ analyticsAttached: true, workspaceAttached: true });
/** Channel stored (or the step deliberately skipped): delivery is settled. */
const SETTLED = facts({
  analyticsAttached: true,
  workspaceAttached: true,
  deliveryResolved: true,
});

describe("nextBlocker — the one next thing, in every reachable state", () => {
  test("nothing connected asks for analytics, and says it is the only thing needed", () => {
    const blocker = nextBlocker(FRESH);

    expect(blocker?.id).toBe("analytics");
    expect(blocker?.sentence).toBe(
      "First, connect the analytics you already run. It is the only thing we need to start.",
    );
  });

  test("analytics attached asks where what we find should arrive", () => {
    expect(nextBlocker(READING)?.id).toBe("delivery");
  });

  test("a workspace with no channel asks for the channel, not for the workspace again", () => {
    // The shipped screen could not reach this state — pasting a token and a
    // channel id was one act. Asking for the workspace a second time here
    // would send a founder back to a button they have already pressed.
    expect(nextBlocker(MID_OAUTH)?.id).toBe("channel");
  });

  test("delivery settled asks the founder to start the watch", () => {
    expect(nextBlocker(SETTLED)?.id).toBe("arm");
  });

  test("armed has nothing left to block, and hands over to the shipped stage", () => {
    // `null` is the handover, not an absence of anything to say: `reduceStage`
    // owns every state in the wait and always has.
    expect(nextBlocker({ ...SETTLED, armedAt: new Date("2026-08-01T14:02:00Z") })).toBeNull();
  });

  test("a skipped delivery step resolves the chain rather than blocking it", () => {
    // FR-O14 / deviation 2: a skip is a legitimate finished answer. A chain
    // that kept asking would make the offered option a dead end.
    const skipped = facts({ analyticsAttached: true, deliveryResolved: true });

    expect(nextBlocker(skipped)?.id).toBe("arm");
    expect(canArm(skipped)).toBe(true);
  });

  test("delivery connected before analytics still asks for analytics first", () => {
    // Order is the array's, not the founder's. Connecting Slack from a second
    // tab must not skip the connection the product cannot work without.
    expect(nextBlocker(facts({ workspaceAttached: true, deliveryResolved: true }))?.id).toBe(
      "analytics",
    );
  });
});

describe("canArm — the trap the shipped screen left open", () => {
  test("a founder with nothing connected cannot start a watch", () => {
    // THE DEFECT THIS ROW PINS. The shipped screen rendered "Start watching"
    // unconditionally. Pressing it with no analytics connection stamped a
    // persisted origin and started a clock over a product we had no way to
    // read — a wait that could never end, offered as the primary action on
    // the page.
    expect(canArm(FRESH)).toBe(false);
  });

  test("analytics alone is enough — delivery is not required to watch", () => {
    // The same decision FR-O14 already made: what a skipped Slack step costs
    // is where the result goes afterwards, not the ability to watch.
    expect(canArm(facts({ analyticsAttached: true, deliveryResolved: true }))).toBe(true);
    expect(canArm(READING)).toBe(false);
  });

  test("a connected workspace with no channel cannot yet arm", () => {
    // Mid-OAuth is not settled: there is a token and nowhere to post.
    expect(canArm(MID_OAUTH)).toBe(false);
  });

  test("arming is offered exactly when the chain has reached its last link", () => {
    // The two must never disagree — a button offered while the panel above it
    // is still asking for something is the contradiction the chain removes.
    const states = [FRESH, READING, MID_OAUTH, SETTLED];

    for (const state of states) {
      expect(canArm(state)).toBe(nextBlocker(state)?.id === "arm");
    }
  });
});

describe("the chain's copy", () => {
  test("every sentence the chain can render is registered in the copy home", () => {
    // FR-O22: a sentence that reaches this screen without passing the
    // plain-English audit is exactly what the one-home rule exists to stop.
    const registered = new Set(ALL_ONBOARDING_MESSAGES);

    for (const blocker of SETUP_BLOCKERS) {
      expect(registered.has(blocker.heading)).toBe(true);
      expect(registered.has(blocker.sentence)).toBe(true);
    }
  });

  test("no two links share a sentence", () => {
    // A repeated sentence means two states a founder cannot tell apart, which
    // is the same as having no sentence for one of them.
    const sentences = SETUP_BLOCKERS.map((blocker) => blocker.sentence);

    expect(new Set(sentences).size).toBe(sentences.length);
  });

  test("the headings carry progress — they change, and they repeat only while nothing has", () => {
    // Read down the column: nothing yet, we can see your product, we can see
    // your product, nothing is being watched yet. The middle pair repeats
    // because between them the founder has learned nothing new about what we
    // can see; the sentence beside them is what differs.
    const headings = SETUP_BLOCKERS.map((blocker) => blocker.heading);

    expect(headings[1]).toBe("We can see your product.");
    expect(headings[1]).toBe(headings[2]);
    expect(new Set(headings).size).toBe(2);
  });
});
