import { describe, expect, test } from "bun:test";

import { selectReplaySessions, toReplayRow } from "../../src/replay-filters/select";
import { fact, filtersOf } from "./fixtures";

const ACME_AT_PRICING = fact({
  sessionKey: "ph:acme-pricing",
  identityEmailDomain: "acme.com",
  entryUrlPath: "/pricing",
});

const ACME_AT_DOCS = fact({
  sessionKey: "ph:acme-docs",
  identityEmailDomain: "acme.com",
  entryUrlPath: "/docs",
});

const ORBIT_AT_PRICING = fact({
  sessionKey: "ph:orbit-pricing",
  identityEmailDomain: "orbitlabs.co.uk",
  entryUrlPath: "/pricing",
});

describe("selectReplaySessions", () => {
  test("should return the intersection when company and entry are both active", () => {
    const sessions = [ACME_AT_PRICING, ACME_AT_DOCS, ORBIT_AT_PRICING];

    const selection = selectReplaySessions(
      sessions,
      filtersOf({ company: "acme.com", entry: "/pricing" }),
    );

    expect(selection.rows.map((row) => row.sessionKey)).toEqual(["ph:acme-pricing"]);
  });

  test("should list only sessions whose session key yields a recording id", () => {
    const unrecorded = fact({ sessionKey: "gm:no-replay", identityEmailDomain: "acme.com" });
    const sessions = [ACME_AT_PRICING, unrecorded];

    const selection = selectReplaySessions(sessions, filtersOf());

    expect(selection.rows.map((row) => row.sessionKey)).toEqual(["ph:acme-pricing"]);
    expect(selection.provenance.sessions).toBe(2);
    expect(toReplayRow(unrecorded)).toBeNull();
    expect(toReplayRow(ACME_AT_PRICING)?.recordingId).toBe("acme-pricing");
  });

  test("should derive the provenance numerator and the row count from one selection", () => {
    const sessions = [
      ACME_AT_PRICING,
      ACME_AT_DOCS,
      fact({ sessionKey: "gm:acme-unrecorded", identityEmailDomain: "acme.com" }),
    ];

    const selection = selectReplaySessions(sessions, filtersOf({ company: "acme.com" }));

    expect(selection.rows).toHaveLength(selection.provenance.replays);
    expect(selection.provenance.replays).toBeLessThanOrEqual(selection.provenance.sessions);
  });
});
