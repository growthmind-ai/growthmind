import { describe, expect, test } from "bun:test";

import { leadInView, shouldRevealLead, type LeadBox } from "../../lib/first-run/lead-reveal";

import { blankComments, readExisting } from "./helpers/first-run-source";

const VIEWPORT = 800;

const ABOVE: LeadBox = { top: -420, bottom: -220 };
const BELOW: LeadBox = { top: 980, bottom: 1180 };
const WHOLE: LeadBox = { top: 40, bottom: 240 };
const CLIPPED: LeadBox = { top: -12, bottom: 188 };
const TALLER_THAN_VIEWPORT: LeadBox = { top: 0, bottom: 1200 };

const reveal = (offeredBefore: boolean, offeredNow: boolean, box: LeadBox | null): boolean =>
  shouldRevealLead({ offeredBefore, offeredNow, box, viewportHeight: VIEWPORT });

describe("leadInView", () => {
  test("only a panel whole inside the viewport is in view", () => {
    expect(leadInView(WHOLE, VIEWPORT)).toBe(true);
    expect(leadInView(ABOVE, VIEWPORT)).toBe(false);
    expect(leadInView(BELOW, VIEWPORT)).toBe(false);
    expect(leadInView(CLIPPED, VIEWPORT)).toBe(false);
    expect(leadInView(TALLER_THAN_VIEWPORT, VIEWPORT)).toBe(false);
  });

  test("a panel flush with either edge is in view", () => {
    expect(leadInView({ top: 0, bottom: VIEWPORT }, VIEWPORT)).toBe(true);
    expect(leadInView({ top: VIEWPORT - 1, bottom: VIEWPORT }, VIEWPORT)).toBe(true);
  });
});

describe("shouldRevealLead", () => {
  test("the last step completing while the panel is off the top brings it back", () => {
    expect(reveal(false, true, ABOVE)).toBe(true);
  });

  test("a panel below the fold is revealed too", () => {
    expect(reveal(false, true, BELOW)).toBe(true);
  });

  test("a panel already whole on screen is left where it is", () => {
    expect(reveal(false, true, WHOLE)).toBe(false);
  });

  test("a panel clipped by one edge is not left half-read", () => {
    expect(reveal(false, true, CLIPPED)).toBe(true);
  });

  test("an offer that was already on screen does not scroll again on every poll", () => {
    expect(reveal(true, true, ABOVE)).toBe(false);
  });

  test("a reload landing on a completed setup does not yank the page", () => {
    expect(reveal(true, true, BELOW)).toBe(false);
  });

  test("setup still incomplete reveals nothing", () => {
    expect(reveal(false, false, ABOVE)).toBe(false);
  });

  test("arming, which withdraws the offer, reveals nothing", () => {
    expect(reveal(true, false, ABOVE)).toBe(false);
  });

  test("an unmeasurable panel reveals nothing rather than throwing", () => {
    expect(reveal(false, true, null)).toBe(false);
  });

  test("a zero-height viewport is not a reason to sit still", () => {
    expect(
      shouldRevealLead({ offeredBefore: false, offeredNow: true, box: WHOLE, viewportHeight: 0 }),
    ).toBe(true);
  });
});

describe("the wire into the client (D11)", () => {
  const CLIENT = "apps/web/components/first-run/FirstRunClient.tsx";

  test("the client calls the decision, holds a ref on the lead panel, and scrolls", () => {
    const code = blankComments(readExisting(CLIENT).source);

    expect(code).toContain("shouldRevealLead");
    expect(code).toMatch(/<Box\s+ref=\{lead\}>/);
    expect(code).toMatch(/lead\.current/);
    expect(code).toMatch(/scrollIntoView/);
  });

  test("the scroll honours a reader who asked for less motion", () => {
    const code = blankComments(readExisting(CLIENT).source);

    expect(code).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(code).toMatch(/behavior:\s*\w+\s*\?\s*"auto"\s*:\s*"smooth"/);
  });
});
