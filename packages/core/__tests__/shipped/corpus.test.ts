import { describe, expect, test } from "bun:test";

import { buildAtPageCorpus } from "../../src/shipped/corpus";
import { SHIPPED_WINDOW, atPageInput, mustBuild, shippedCorpus } from "./fixtures";

describe("the at-page corpus carries what the window said about itself", () => {
  test("should carry the window the corpus was read over as the timeframe", () => {
    const built = mustBuild(
      buildAtPageCorpus(atPageInput(shippedCorpus({ totalSessions: 40, atPage: 18 }))),
    );

    expect(built.timeframe).toEqual(SHIPPED_WINDOW);
  });

  test("should carry the truncation flag verbatim rather than deciding it again", () => {
    const whole = shippedCorpus({ totalSessions: 40, atPage: 18 });
    const capped = shippedCorpus({ totalSessions: 40, atPage: 18, truncated: true });

    expect(mustBuild(buildAtPageCorpus(atPageInput(whole))).truncated).toBe(false);
    expect(mustBuild(buildAtPageCorpus(atPageInput(capped))).truncated).toBe(true);
  });

  test("should record the kind it was built for, so the readout cannot infer the wrong corpus", () => {
    const corpus = shippedCorpus({
      totalSessions: 40,
      atPage: 18,
      recordedAtPage: 6,
      touchedAtPage: 2,
    });

    expect(mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "page" }))).kind).toBe("page");
    expect(mustBuild(buildAtPageCorpus(atPageInput(corpus, { kind: "recorded" }))).kind).toBe(
      "recorded",
    );
  });

  test("should never count a set-aside session as having touched the change", () => {
    // The at-page sessions the fixture sets aside are the last ones, and the numerator must be a
    // subset of the denominator it is stated against.
    const built = mustBuild(
      buildAtPageCorpus(
        atPageInput(shippedCorpus({ totalSessions: 40, atPage: 18, excludedAtPage: 5 })),
      ),
    );

    expect(built.basis.kept).toBe(13);
    expect(built.touchedSessions).toBeLessThanOrEqual(built.basis.kept);
  });
});
