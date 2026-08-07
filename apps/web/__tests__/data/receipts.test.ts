import { describe, expect, test } from "bun:test";

import { EXCLUSION_REASON_LABELS, type ExclusionReason } from "@growthmind/shared";

import {
  chipLabel,
  countReceipt,
  dataPageText,
  DATA_GROUPS,
  everythingSetAsideNote,
  mixedVersionNote,
  unclaimedSetAside,
  type CountsView,
} from "../../components/data/statements";

function aside(reason: ExclusionReason, count: number) {
  return { reason, count, label: EXCLUSION_REASON_LABELS[reason] };
}

const READY: CountsView = {
  total: 203,
  kept: 187,
  setAside: [
    aside("automation_headless", 6),
    aside("internal_domain", 5),
    aside("automation_known_agent", 3),
    aside("automation_coding_agent", 2),
  ],
  ruleSetVersions: [1],
};

const EMPTY: CountsView = { total: 0, kept: 0, setAside: [], ruleSetVersions: [] };

const TEAM = { kind: "count", reasons: ["internal_domain"] } as const;
const AUTOMATION = {
  kind: "count",
  reasons: ["automation_headless", "automation_known_agent", "automation_coding_agent"],
} as const;
const KEPT = { kind: "kept" } as const;

describe("every number on /data carries its denominator", () => {
  test("a count chip states the count, the total, and the unit", () => {
    expect(chipLabel(READY, TEAM)).toBe("5 of 203 sessions");
    expect(chipLabel(READY, AUTOMATION)).toBe("11 of 203 sessions");
    expect(chipLabel(READY, KEPT)).toBe("187 of 203 sessions");
  });

  test("the page adds up: every set-aside row plus the kept rows equal the total", () => {
    const setAside = READY.setAside.reduce((sum, entry) => sum + entry.count, 0);

    expect(setAside + READY.kept).toBe(READY.total);
  });

  test("a receipt body repeats the denominator beside its own subtotal", () => {
    const view = countReceipt(READY, AUTOMATION);

    expect(view?.subtotal).toBe(11);
    expect(view?.total).toBe(203);
    expect(view?.rows.map((row) => row.label)).toEqual([
      "Automated browser tests",
      "Crawlers, monitors and scripts",
      "Coding agents",
    ]);
  });
});

describe("a workspace with nothing in it onboards instead of reporting a vacuum", () => {
  test('an empty workspace never renders "0 of 0"', () => {
    for (const receipt of [TEAM, AUTOMATION, KEPT]) {
      expect(chipLabel(EMPTY, receipt)).toBe("Nothing seen yet");
    }
  });

  test("the empty note names what produces the first row", () => {
    const text = dataPageText(EMPTY);

    expect(text).toContain("Nothing seen yet");
    expect(text).not.toContain("0 of 0");
  });
});

describe("a count spanning a rule change says so rather than claiming one rule set", () => {
  test("one version needs no note", () => {
    expect(mixedVersionNote(READY)).toBeNull();
    expect(mixedVersionNote(EMPTY)).toBeNull();
  });

  test("two versions are both named, and the note travels into the copied document", () => {
    const mixed: CountsView = { ...READY, ruleSetVersions: [1, 2] };
    const note = mixedVersionNote(mixed);

    expect(note).toContain("v1 and v2");
    expect(dataPageText(mixed)).toContain("v1 and v2");
  });

  test("three versions are listed, not truncated to the first", () => {
    expect(mixedVersionNote({ ...READY, ruleSetVersions: [1, 2, 3] })).toContain("v1, v2 and v3");
  });
});

describe("the page still adds up when a rule it never described stamps a row", () => {
  test("a reason no statement claims is rendered rather than dropped", () => {
    const withUnclaimed: CountsView = {
      ...READY,
      setAside: [...READY.setAside, aside("outside_who_counts", 4)],
    };

    expect(unclaimedSetAside(withUnclaimed)).toEqual([
      { label: "Not who you said counts", count: 4 },
    ]);
  });

  test("every reason the current statements describe is claimed", () => {
    expect(unclaimedSetAside(READY)).toEqual([]);
  });
});

describe("total exclusion is diagnosed, not celebrated", () => {
  test("kept = 0 with sessions seen names the dominant rule", () => {
    const note = everythingSetAsideNote({
      total: 203,
      kept: 0,
      setAside: [aside("internal_domain", 203)],
      ruleSetVersions: [1],
    });

    expect(note).toContain("203");
    expect(note).toContain("your own team");
  });

  test("an empty workspace is not a total-exclusion diagnosis", () => {
    expect(everythingSetAsideNote(EMPTY)).toBeNull();
    expect(everythingSetAsideNote(READY)).toBeNull();
  });
});

describe("the copied document does not depend on what the sender opened", () => {
  test("every group, every statement, and every stamp are in the text", () => {
    const text = dataPageText(READY);

    for (const group of DATA_GROUPS) {
      expect(text).toContain(group.label);
      if (group.stamp !== undefined) expect(text).toContain(group.stamp);

      for (const statement of group.statements) {
        expect(text).toContain(statement.text);
      }
    }
  });

  test("a document copied with no counts still carries every rule", () => {
    const text = dataPageText(null);

    for (const group of DATA_GROUPS) {
      for (const statement of group.statements) {
        expect(text).toContain(statement.text);
      }
    }
  });
});
