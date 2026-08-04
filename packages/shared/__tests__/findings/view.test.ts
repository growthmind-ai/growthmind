import { describe, expect, test } from "bun:test";

import { evidenceForAgent } from "../../src/findings/agent-text";
import { beatsAreCited, claimRows, rowsInGroup } from "../../src/findings/view";
import type { ClaimView, EvidenceView, FindingRow } from "../../src/findings/view";

function claim(statement: string, citesBeats: readonly number[]): ClaimView {
  return { statement, citesBeats, citesLabel: "from 00:11" };
}

function row(id: string, group: FindingRow["group"]): FindingRow {
  return {
    id,
    group,
    headline: `headline ${id}`,
    context: `context ${id}`,
    aside: null,
    numerator: 1,
    denominator: 10,
    observedOn: "2 Aug",
  };
}

describe("claimRows", () => {
  test("anchors a note to the grid row of its first cited beat", () => {
    expect(claimRows([claim("a", [3, 4])])).toEqual([4]);
  });

  test("pushes a colliding note below its predecessor rather than overlapping it", () => {
    const rows = claimRows([claim("a", [3, 4]), claim("b", [3]), claim("c", [3])]);

    expect(rows).toEqual([4, 5, 6]);
    expect(new Set(rows).size).toBe(rows.length);
  });

  test("keeps later notes below earlier ones even when they cite earlier beats", () => {
    const rows = claimRows([claim("a", [6]), claim("b", [1])]);

    expect(rows[1]).toBeGreaterThan(rows[0] as number);
  });

  test("places an uncited claim directly after its predecessor", () => {
    expect(claimRows([claim("a", [2]), claim("b", [])])).toEqual([3, 4]);
  });

  test("returns nothing for no claims", () => {
    expect(claimRows([])).toEqual([]);
  });
});

describe("beatsAreCited", () => {
  const claims = [claim("a", [3, 4])];

  test("marks a beat a claim rests on", () => {
    expect(beatsAreCited(claims, 3)).toBe(true);
    expect(beatsAreCited(claims, 4)).toBe(true);
  });

  test("leaves an uncited beat unmarked", () => {
    expect(beatsAreCited(claims, 0)).toBe(false);
  });

  test("marks nothing when every claim was dropped", () => {
    expect(beatsAreCited([], 3)).toBe(false);
  });
});

describe("evidenceForAgent", () => {
  const evidence: EvidenceView = {
    id: "8c21",
    headline: "People can't send team invites",
    countLine: "14 of 110 sessions",
    beats: [
      {
        index: 0,
        at: "00:00",
        kind: "navigate",
        text: "landed /settings/team",
        notable: false,
        attempt: null,
      },
      {
        index: 1,
        at: "00:11",
        kind: "network",
        text: "POST /api/team/invite failed",
        notable: true,
        attempt: null,
      },
      {
        index: 2,
        at: "00:19",
        kind: "click",
        text: 'clicked "Send invite"',
        notable: false,
        attempt: 2,
      },
    ],
    claims: [claim("The request behind the button fails.", [1])],
    droppedClaims: 1,
    cohortLine: "96 people got through.",
    sessions: [],
    currentSessionId: "s1",
    coverageLine: "Read from 110 sessions.",
    withheld: false,
  };

  test("carries the claim, its citation and every beat the founder saw", () => {
    const text = evidenceForAgent(evidence);

    expect(text).toContain("The request behind the button fails. (from 00:11)");
    expect(text).toContain("00:11  POST /api/team/invite failed");
    expect(text).toContain("landed /settings/team");
    expect(text).toContain("Read from 110 sessions.");
  });

  test("marks a repeated attempt, so the agent reads struggle rather than three clicks", () => {
    expect(evidenceForAgent(evidence)).toContain("[attempt 2]");
  });

  test("a withheld recording hands over the counts and no transcript", () => {
    const text = evidenceForAgent({
      ...evidence,
      beats: [],
      claims: [],
      cohortLine: null,
      withheld: true,
    });

    expect(text).not.toContain("One person's session");
    expect(text).not.toContain("What we think happened");
    expect(text).toContain("14 of 110 sessions");
  });
});

describe("rowsInGroup", () => {
  const rows = [row("a", "explained"), row("b", "withheld"), row("c", "explained")];

  test("returns only the rows in the asked-for group, in order", () => {
    expect(rowsInGroup(rows, "explained").map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  test("returns nothing for a group with no rows", () => {
    expect(rowsInGroup(rows, "measurement")).toEqual([]);
  });
});
