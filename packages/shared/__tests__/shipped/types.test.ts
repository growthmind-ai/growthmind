import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import {
  NO_CONTROL_LABEL,
  SHIPPED_CHANGE_CONFLICT_TARGET,
  SHIPPED_CHANGE_STATES,
  SHIPPED_READOUT_OUTCOMES,
  SHIPPED_READOUT_TASK,
  SHIPPED_UNMEASURED_OUTCOMES,
  SHIPPED_VERDICTS,
} from "../../src/shipped/types";

describe("a reported change is in exactly one of four states", () => {
  test("the four states are reported, read out, closed and abandoned", () => {
    expect([...SHIPPED_CHANGE_STATES].toSorted()).toEqual([
      "abandoned",
      "closed",
      "read_out",
      "reported",
    ]);
  });

  test("there is no fifth state for a change to be orphaned in", () => {
    expect(SHIPPED_CHANGE_STATES.length).toBe(4);
    expect(new Set(SHIPPED_CHANGE_STATES).size).toBe(4);
  });
});

describe("the founder's answer is one of four, and silence is one of them", () => {
  test("the four verdicts are keep, kill, leave and no verdict given", () => {
    expect([...SHIPPED_VERDICTS].toSorted()).toEqual(["keep", "kill", "leave", "no_verdict_given"]);
  });

  test("a window that lapses records an answer rather than nothing", () => {
    const verdicts: readonly string[] = SHIPPED_VERDICTS;
    expect(verdicts).toContain("no_verdict_given");
    expect(SHIPPED_VERDICTS.length).toBe(4);
  });
});

describe("what the readout managed to say is recorded beside the answer, not as an answer", () => {
  test("the unmeasured branches are the three the renderer cannot put a number on", () => {
    expect([...SHIPPED_UNMEASURED_OUTCOMES].toSorted()).toEqual([
      "corpus_predates_who_counts",
      "stale_page_spelling",
      "too_few",
    ]);
  });

  test("measured is the only outcome outside them, and none of them is a verdict", () => {
    expect([...SHIPPED_READOUT_OUTCOMES].toSorted()).toEqual([
      "corpus_predates_who_counts",
      "measured",
      "stale_page_spelling",
      "too_few",
    ]);

    // A fifth verdict would put our own measurement failure in the founder's mouth, which is
    // the whole reason this is a second column rather than another answer.
    const verdicts: readonly string[] = SHIPPED_VERDICTS;
    for (const outcome of SHIPPED_READOUT_OUTCOMES) {
      expect(verdicts).not.toContain(outcome);
    }
    expect(SHIPPED_VERDICTS.length).toBe(4);
  });
});

describe("the change key is one list, read by the index and by the upsert", () => {
  test("the conflict target names the organization, the project, the page and the control", () => {
    expect([...SHIPPED_CHANGE_CONFLICT_TARGET]).toEqual([
      "organization_id",
      "project_id",
      "page",
      "control_label",
    ]);
  });

  test("the whole-page sentinel is the empty string, so no key column is ever null", () => {
    expect(NO_CONTROL_LABEL).toBe("");
  });
});

describe("the readout task is named once", () => {
  test("the task name is a name the worker runtime can register", () => {
    const taskNamesPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "..",
      "..",
      "worker",
      "src",
      "task-names.ts",
    );
    const source = readFileSync(taskNamesPath, "utf8");

    const declaration = source.match(/GRAPHILE_TASK_NAME_PATTERN = \/(.+)\/;/);
    if (!declaration?.[1]) {
      throw new Error("worker/src/task-names.ts no longer declares GRAPHILE_TASK_NAME_PATTERN");
    }

    expect(new RegExp(declaration[1]).test(SHIPPED_READOUT_TASK)).toBe(true);
  });

  test("the task name is namespaced to this change, not a bare word", () => {
    expect(SHIPPED_READOUT_TASK.startsWith("shipped:")).toBe(true);
    expect(SHIPPED_READOUT_TASK.length).toBeGreaterThan("shipped:".length);
  });
});
