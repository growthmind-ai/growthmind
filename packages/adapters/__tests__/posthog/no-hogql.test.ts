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
