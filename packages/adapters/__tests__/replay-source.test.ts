import { describe, expect, test } from "bun:test";

import { readAdapterSources } from "./helpers/source-scan";

const REPLAY_SOURCE_IMPLEMENTATION = /\)\s*:\s*ReplaySource\s*\{/;

describe("the ReplaySource port", () => {
  test("exactly one ReplaySource implementation is referenced, by name — no registry, factory map, or dynamic lookup", () => {
    const files = readAdapterSources();

    const implementations = files
      .filter((file) => REPLAY_SOURCE_IMPLEMENTATION.test(file.code))
      .map((file) => file.path);
    expect(implementations).toEqual(["rrweb/replay-source.ts"]);
  });

  test("CONTROL: the scan would see a second implementation if one were planted", () => {
    const planted = [
      {
        path: "rrweb/replay-source.ts",
        code: "export function createRrwebReplaySource(): ReplaySource {\n  return real;\n}",
      },
      {
        path: "rrweb/shadow-replay-source.ts",
        code: "export function createShadowReplaySource(): ReplaySource {\n  return offender;\n}",
      },
    ];

    const offenders = planted
      .filter((file) => REPLAY_SOURCE_IMPLEMENTATION.test(file.code))
      .map((file) => file.path);
    expect(offenders).toEqual(["rrweb/replay-source.ts", "rrweb/shadow-replay-source.ts"]);
  });
});
