import { describe, expect, test } from "bun:test";

import {
  loadValueUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";

const OWNER =
  "ADD O-024 AD-8 (apps/web/components/first-run/chip-state.ts — the UX §5 machine as a pure function)";

type ChipView = "live" | "idle" | "noting" | "noted" | "noted-on-load" | "no-ping";

// The reducer's whole input, W-4's contract: the catalogue's live flag, the
// payload's two facts, and this visit's tap lifecycle. Nothing else may decide
// a chip's view — errors carry no channel of their own, they are `tap: "failed"`.
interface ChipViewInput {
  readonly live: boolean;
  readonly interestPingAvailable: boolean;
  readonly notedOnLoad: boolean;
  readonly tap: "none" | "in-flight" | "done" | "failed";
}

type ResolveChipView = (input: ChipViewInput) => ChipView;

const loadResolveChipView = (): Promise<ResolveChipView> =>
  loadValueUnderConstruction<ResolveChipView>({
    modulePath: underConstructionSpecifier("apps/web/components/first-run/chip-state"),
    exportName: "resolveChipView",
    ownedBy: OWNER,
  });

const CHIP_VIEWS: readonly ChipView[] = [
  "live",
  "idle",
  "noting",
  "noted",
  "noted-on-load",
  "no-ping",
];

const TAPS = ["none", "in-flight", "done", "failed"] as const;
const BOOLS = [false, true] as const;

function everyInput(): readonly ChipViewInput[] {
  const all: ChipViewInput[] = [];
  for (const live of BOOLS) {
    for (const interestPingAvailable of BOOLS) {
      for (const notedOnLoad of BOOLS) {
        for (const tap of TAPS) {
          all.push({ live, interestPingAvailable, notedOnLoad, tap });
        }
      }
    }
  }
  return all;
}

const soon = (input: Omit<ChipViewInput, "live">): ChipViewInput => ({ ...input, live: false });

describe("resolveChipView — the six-state chip machine (W-4, UX §5)", () => {
  test("every input lands in one of the six named states, and all six are reached", async () => {
    const resolveChipView = await loadResolveChipView();

    const inputs = everyInput();
    expect(inputs).toHaveLength(32);

    const seen = new Set(inputs.map((input) => resolveChipView(input)));

    expect([...seen].toSorted()).toEqual([...CHIP_VIEWS].toSorted());
  });

  test("no-ping whenever interestPingAvailable is false, regardless of noted state", async () => {
    const resolveChipView = await loadResolveChipView();

    for (const notedOnLoad of BOOLS) {
      for (const tap of TAPS) {
        const view = resolveChipView(soon({ interestPingAvailable: false, notedOnLoad, tap }));
        expect(`notedOnLoad=${notedOnLoad} tap=${tap}: ${view}`).toBe(
          `notedOnLoad=${notedOnLoad} tap=${tap}: no-ping`,
        );
      }
    }
  });

  test("the live provider renders live under every other input", async () => {
    const resolveChipView = await loadResolveChipView();

    for (const input of everyInput().filter((candidate) => candidate.live)) {
      const view = resolveChipView(input);
      expect(`ping=${input.interestPingAvailable} noted=${input.notedOnLoad} tap=${input.tap}: ${view}`).toBe(
        `ping=${input.interestPingAvailable} noted=${input.notedOnLoad} tap=${input.tap}: live`,
      );
    }
  });

  test("a chip the payload lists renders noted-on-load", async () => {
    const resolveChipView = await loadResolveChipView();

    const view = resolveChipView(
      soon({ interestPingAvailable: true, notedOnLoad: true, tap: "none" }),
    );

    expect(view).toBe("noted-on-load");
  });

  test("an in-flight tap renders noting", async () => {
    const resolveChipView = await loadResolveChipView();

    const view = resolveChipView(
      soon({ interestPingAvailable: true, notedOnLoad: false, tap: "in-flight" }),
    );

    expect(view).toBe("noting");
  });

  test("a completed tap this visit renders noted", async () => {
    const resolveChipView = await loadResolveChipView();

    const view = resolveChipView(
      soon({ interestPingAvailable: true, notedOnLoad: false, tap: "done" }),
    );

    expect(view).toBe("noted");
  });

  test("a fresh soon chip with the ping available is idle", async () => {
    const resolveChipView = await loadResolveChipView();

    const view = resolveChipView(
      soon({ interestPingAvailable: true, notedOnLoad: false, tap: "none" }),
    );

    expect(view).toBe("idle");
  });

  test("a failed tap returns to idle — the card notice is the component's job, not the reducer's", async () => {
    const resolveChipView = await loadResolveChipView();

    const view = resolveChipView(
      soon({ interestPingAvailable: true, notedOnLoad: false, tap: "failed" }),
    );

    expect(view).toBe("idle");
  });
});
