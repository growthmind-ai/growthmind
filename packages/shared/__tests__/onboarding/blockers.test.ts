import { describe, expect, test } from "bun:test";

import {
  canArm,
  nextBlocker,
  SETUP_BLOCKERS,
  type SetupFacts,
} from "../../src/onboarding/blockers";
import { ALL_ONBOARDING_MESSAGES } from "../../src/onboarding/messages";

const FRESH: SetupFacts = Object.freeze({
  analyticsAttached: false,
  workspaceAttached: false,
  deliveryResolved: false,
  armedAt: null,
});

const facts = (over: Partial<SetupFacts>): SetupFacts => ({ ...FRESH, ...over });

const READING = facts({ analyticsAttached: true });

const MID_OAUTH = facts({ analyticsAttached: true, workspaceAttached: true });

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
    expect(nextBlocker(MID_OAUTH)?.id).toBe("channel");
  });

  test("delivery settled asks the founder to start the watch", () => {
    expect(nextBlocker(SETTLED)?.id).toBe("arm");
  });

  test("armed has nothing left to block, and hands over to the shipped stage", () => {
    expect(nextBlocker({ ...SETTLED, armedAt: new Date("2026-08-01T14:02:00Z") })).toBeNull();
  });

  test("a skipped delivery step resolves the chain rather than blocking it", () => {
    const skipped = facts({ analyticsAttached: true, deliveryResolved: true });

    expect(nextBlocker(skipped)?.id).toBe("arm");
    expect(canArm(skipped)).toBe(true);
  });

  test("delivery connected before analytics still asks for analytics first", () => {
    expect(nextBlocker(facts({ workspaceAttached: true, deliveryResolved: true }))?.id).toBe(
      "analytics",
    );
  });
});

describe("canArm — the trap the shipped screen left open", () => {
  test("a founder with nothing connected cannot start a watch", () => {
    expect(canArm(FRESH)).toBe(false);
  });

  test("analytics alone is enough — delivery is not required to watch", () => {
    expect(canArm(facts({ analyticsAttached: true, deliveryResolved: true }))).toBe(true);
    expect(canArm(READING)).toBe(false);
  });

  test("a connected workspace with no channel cannot yet arm", () => {
    expect(canArm(MID_OAUTH)).toBe(false);
  });

  test("arming is offered exactly when the chain has reached its last link", () => {
    const states = [FRESH, READING, MID_OAUTH, SETTLED];

    for (const state of states) {
      expect(canArm(state)).toBe(nextBlocker(state)?.id === "arm");
    }
  });
});

describe("the chain's copy", () => {
  test("every sentence the chain can render is registered in the copy home", () => {
    const registered = new Set(ALL_ONBOARDING_MESSAGES);

    for (const blocker of SETUP_BLOCKERS) {
      expect(registered.has(blocker.heading)).toBe(true);
      expect(registered.has(blocker.sentence)).toBe(true);
    }
  });

  test("no two links share a sentence", () => {
    const sentences = SETUP_BLOCKERS.map((blocker) => blocker.sentence);

    expect(new Set(sentences).size).toBe(sentences.length);
  });

  test("the headings carry progress — they change, and they repeat only while nothing has", () => {
    const headings = SETUP_BLOCKERS.map((blocker) => blocker.heading);

    expect(headings[1]).toBe("We can see your product.");
    expect(headings[1]).toBe(headings[2]);
    expect(new Set(headings).size).toBe(2);
  });
});
