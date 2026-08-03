// The UX §5 chip machine as a pure function (AD-8, W-4). Precedence is the
// contract: live beats everything, an absent ping capability beats noted state,
// the payload's noted fact beats this visit's tap. A failed tap has no state of
// its own — it lands back on idle, and the card notice is the component's job.

export type ChipView = "live" | "idle" | "noting" | "noted" | "noted-on-load" | "no-ping";

export type ChipTap = "none" | "in-flight" | "done" | "failed";

export interface ChipViewInput {
  readonly live: boolean;
  readonly interestPingAvailable: boolean;
  readonly notedOnLoad: boolean;
  readonly tap: ChipTap;
}

export function resolveChipView(input: ChipViewInput): ChipView {
  if (input.live) {
    return "live";
  }
  if (!input.interestPingAvailable) {
    return "no-ping";
  }
  if (input.notedOnLoad) {
    return "noted-on-load";
  }
  if (input.tap === "in-flight") {
    return "noting";
  }
  if (input.tap === "done") {
    return "noted";
  }
  return "idle";
}
