import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

const REPLAY_SRC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "replay",
);

const REGISTRY_DEFINITION =
  /(?:export\s+)?(?:const|let|var|function)\s+PERSISTED_TRANSCRIPT_SERIALISERS\b/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function definitionCount(source: string): number {
  const pattern = new RegExp(REGISTRY_DEFINITION.source, "g");
  return [...stripComments(source).matchAll(pattern)].length;
}

function replaySourceFiles(): readonly string[] {
  return readdirSync(REPLAY_SRC, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => path.join(REPLAY_SRC, entry));
}

const PLANTED_REGISTRY =
  "export const PERSISTED_TRANSCRIPT_SERIALISERS: ReadonlyMap<number, S> = new Map([[1, v1]]);";

const CLEAN_CONSUMER = "const serialiser = PERSISTED_TRANSCRIPT_SERIALISERS.get(version);";

const CLEAN_COMMENTED_OUT = "// export const PERSISTED_TRANSCRIPT_SERIALISERS = new Map();";

describe("one persisted-action serialiser registry, enforced rather than grepped (AC-D12)", () => {
  test("should define exactly one persisted-action serialiser registry in the replay module", () => {
    expect(definitionCount(PLANTED_REGISTRY)).toBe(1);
    expect(definitionCount(CLEAN_CONSUMER)).toBe(0);
    expect(definitionCount(CLEAN_COMMENTED_OUT)).toBe(0);

    const files = replaySourceFiles();
    expect(files.length).toBeGreaterThan(5);

    const definers = files.filter((file) => definitionCount(readFileSync(file, "utf8")) > 0);
    const total = files.reduce(
      (count, file) => count + definitionCount(readFileSync(file, "utf8")),
      0,
    );

    expect(definers.map((file) => path.basename(file))).toEqual(["persisted-transcript.ts"]);
    expect(total).toBe(1);
  });
});
