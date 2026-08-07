import { describe, expect, test } from "bun:test";

import type { ReplayFilters } from "@growthmind/shared";

import { provenanceSentence, tailNote } from "../../src/replay-filters/provenance";
import { filtersOf } from "./fixtures";

interface Form {
  readonly filters: ReplayFilters;
  readonly replays: number;
  readonly sessions: number;
  readonly sentence: string;
}

// The eight forms of .ai/ux/o-050-replays-filters.md §4.2, verbatim.
const FORMS: readonly Form[] = [
  {
    filters: filtersOf(),
    replays: 7,
    sessions: 11,
    sentence: "7 replays from 11 sessions.",
  },
  {
    filters: filtersOf({ company: "acme.com" }),
    replays: 3,
    sessions: 5,
    sentence: "3 replays from 5 acme.com sessions.",
  },
  {
    filters: filtersOf({ entry: "/pricing" }),
    replays: 2,
    sessions: 4,
    sentence: "2 replays from 4 sessions that started at /pricing.",
  },
  {
    filters: filtersOf({ company: "acme.com", entry: "/pricing" }),
    replays: 1,
    sessions: 3,
    sentence: "1 replay from 3 acme.com sessions that started at /pricing.",
  },
  {
    filters: filtersOf({ lane: "simulated" }),
    replays: 0,
    sessions: 2,
    sentence: "0 replays from 2 simulated sessions.",
  },
  {
    filters: filtersOf({ lane: "excluded" }),
    replays: 2,
    sessions: 4,
    sentence: "2 replays from 4 sessions we left out of your findings.",
  },
  {
    filters: filtersOf({ lane: "excluded", company: "acme.com" }),
    replays: 1,
    sessions: 2,
    sentence: "1 replay from 2 acme.com sessions we left out of your findings.",
  },
  {
    filters: filtersOf({ lane: "simulated", company: "acme.com", entry: "/pricing" }),
    replays: 0,
    sessions: 0,
    sentence: "0 replays from 0 acme.com simulated sessions that started at /pricing.",
  },
];

describe("provenanceSentence", () => {
  test("should render all eight provenance forms from the UX spec", () => {
    for (const form of FORMS) {
      expect(
        provenanceSentence({ replays: form.replays, sessions: form.sessions }, form.filters),
      ).toBe(form.sentence);
    }
  });

  test("should pluralise 1 replay and N replays, taking the plural at zero", () => {
    const none = provenanceSentence({ replays: 0, sessions: 0 }, filtersOf());
    const one = provenanceSentence({ replays: 1, sessions: 1 }, filtersOf());

    expect(none).toBe("0 replays from 0 sessions.");
    expect(none.toLowerCase()).not.toContain("no replay");
    expect(one).toBe("1 replay from 1 session.");
  });

  test("should carry both numbers in every form, including the composed one", () => {
    for (const form of FORMS) {
      const rendered = provenanceSentence(
        { replays: form.replays, sessions: form.sessions },
        form.filters,
      );

      expect(rendered.match(/\d+/g)).toEqual([String(form.replays), String(form.sessions)]);
    }
  });
});

describe("tailNote", () => {
  test("should render the tail note in the singular at a gap of one, the plural above it, and nothing when the numbers match", () => {
    expect(tailNote({ replays: 4, sessions: 5 })).toBe(
      "1 matching session wasn't recorded, so it isn't listed above.",
    );
    expect(tailNote({ replays: 4, sessions: 7 })).toBe(
      "3 matching sessions weren't recorded, so they aren't listed above.",
    );
    expect(tailNote({ replays: 4, sessions: 4 })).toBeNull();
  });
});
