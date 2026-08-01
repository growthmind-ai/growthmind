// item 60, / decision 0001.
//
// The events list API satisfied retrievability in 40 of 40 trials; the HogQL query API
// hit the 120-second ceiling in 40 of 40 and surfaced no fresh event. HogQL joins
// persons and is viable for a batch backfill of identity. It is prohibited on the poll
// path.
//
// Comments are stripped before the search: `posthog/session-source.ts` deliberately
// discusses HogQL in its header to stop a future contributor putting it back, and a
// naive grep would fire on the warning instead of on a violation.
import { expect, test } from "bun:test";

import { readAdapterSources } from "../helpers/source-scan";

test("no HogQL or /query call exists on the poll path", () => {
  const offenders: string[] = [];

  for (const file of readAdapterSources()) {
    if (/hogql/i.test(file.code)) {
      offenders.push(`${file.path}: references HogQL in code`);
    }
    if (/\/query/.test(file.code)) {
      offenders.push(`${file.path}: references a /query endpoint in code`);
    }
  }

  expect(offenders).toEqual([]);
});
