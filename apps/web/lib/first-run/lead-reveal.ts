export interface LeadBox {
  readonly top: number;
  readonly bottom: number;
}

export interface LeadRevealInput {
  readonly offeredBefore: boolean;
  readonly offeredNow: boolean;

  readonly box: LeadBox | null;
  readonly viewportHeight: number;
}

export function leadInView(box: LeadBox, viewportHeight: number): boolean {
  return box.top >= 0 && box.bottom <= viewportHeight;
}

// The arm control sits above the steps, so completing the last step offers it off the
// top of the screen. True on that transition alone — not on arrival, not when the panel
// is already whole in the viewport.
export function shouldRevealLead(input: LeadRevealInput): boolean {
  if (!input.offeredNow || input.offeredBefore) {
    return false;
  }

  return input.box === null ? false : !leadInView(input.box, input.viewportHeight);
}
