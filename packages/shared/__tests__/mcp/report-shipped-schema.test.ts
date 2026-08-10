import { describe, expect, test } from "bun:test";

import { reportShippedInputSchema } from "../../src/mcp/report-shipped";
import { NO_CONTROL_LABEL } from "../../src/shipped/types";

const REPORT = { description: "CSV export", page: "/reports" };

describe("what an assistant may say it shipped", () => {
  test("a report that names no page is refused", () => {
    expect(reportShippedInputSchema.safeParse({ description: "CSV export" }).success).toBe(false);
  });

  test("a report naming a change and a page is accepted with no control", () => {
    const parsed = reportShippedInputSchema.safeParse(REPORT);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("unreachable: a change and a page is a whole report");
    }
    expect(parsed.data.control).toBeUndefined();
  });

  test("a report naming a control on that page is accepted", () => {
    expect(reportShippedInputSchema.safeParse({ ...REPORT, control: "Export CSV" }).success).toBe(
      true,
    );
  });

  test("the whole-page sentinel cannot be sent as a control label", () => {
    expect(NO_CONTROL_LABEL).toBe("");
    expect(
      reportShippedInputSchema.safeParse({ ...REPORT, control: NO_CONTROL_LABEL }).success,
    ).toBe(false);
  });
});

describe("the date this is answered on is ours, not the caller's", () => {
  test("a caller-supplied readout date is refused whatever it is spelled", () => {
    for (const key of ["readoutDate", "readout_date", "resultsBy", "results_by", "date"]) {
      const parsed = reportShippedInputSchema.safeParse({
        ...REPORT,
        [key]: "2026-08-23T00:00:00.000Z",
      });
      expect({ key, accepted: parsed.success }).toEqual({ key, accepted: false });
    }
  });

  test("there is no date field to fill in in the first place", () => {
    expect(Object.keys(reportShippedInputSchema.shape).toSorted()).toEqual([
      "control",
      "description",
      "page",
      "projectId",
    ]);
  });
});
