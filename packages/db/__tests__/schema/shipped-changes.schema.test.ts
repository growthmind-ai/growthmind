// RED in Wave 0 against a table Wave 2 writes. The one partial-index precedent in the tree
// (recording-summaries.ts:108-110) EXEMPTS nulls; copying it here would let every page-level
// re-report insert a second row. See .ai/adds/o-053-report-shipped.md Decision 3a.
import { describe, expect, test } from "bun:test";

import { getTableColumns } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  NO_CONTROL_LABEL,
  SHIPPED_CHANGE_CONFLICT_TARGET,
  SHIPPED_CHANGE_STATES,
  SHIPPED_VERDICTS,
} from "@growthmind/shared";

import { shippedChanges } from "../../src/schema/shipped-changes";
import { shippedChangeVerdicts } from "../../src/schema/shipped-change-verdicts";

const CHANGE_KEY_INDEX = "shipped_changes_change_key_uidx";
const VERDICT_INDEX = "shipped_change_verdicts_change_uidx";

function indexNamed(table: Parameters<typeof getTableConfig>[0], name: string) {
  return getTableConfig(table).indexes.find((index) => index.config.name === name);
}

function columnNamesOf(index: ReturnType<typeof indexNamed>): string[] {
  return (index?.config.columns ?? []).map((column) => (column as PgColumn).name ?? "");
}

function columnsByName(
  table: Parameters<typeof getTableColumns>[0],
): Map<string, { notNull: boolean; hasDefault: boolean; default: unknown }> {
  return new Map(
    Object.values(getTableColumns(table)).map((column) => [
      column.name,
      { notNull: column.notNull, hasDefault: column.hasDefault, default: column.default },
    ]),
  );
}

describe("the change key is one plain unique index over four real columns", () => {
  test("the change key index column list equals the exported conflict target", () => {
    expect(columnNamesOf(indexNamed(shippedChanges, CHANGE_KEY_INDEX))).toEqual([
      ...SHIPPED_CHANGE_CONFLICT_TARGET,
    ]);
  });

  test("the change key index is unique and carries no partial predicate", () => {
    const index = indexNamed(shippedChanges, CHANGE_KEY_INDEX);

    expect(index).toBeDefined();
    expect(index?.config.unique).toBe(true);
    expect(index?.config.where).toBeUndefined();
  });

  test("the control label is not null and defaults to the whole-page sentinel", () => {
    const column = columnsByName(shippedChanges).get("control_label");

    expect(column?.notNull).toBe(true);
    expect(column?.hasDefault).toBe(true);
    expect(column?.default).toBe(NO_CONTROL_LABEL);
  });

  test("the readout date is not null so a row cannot exist without a clock", () => {
    const column = columnsByName(shippedChanges).get("readout_due_at");

    expect(column?.notNull).toBe(true);
  });

  test("the page normalisation version is not null so a stale spelling is always detectable", () => {
    const column = columnsByName(shippedChanges).get("page_normalisation_version");

    expect(column?.notNull).toBe(true);
  });
});

describe("the state and verdict unions each have exactly four members", () => {
  test("the change state column offers exactly the four ratified states", () => {
    expect(shippedChanges.state.enumValues).toEqual([...SHIPPED_CHANGE_STATES]);
    expect(SHIPPED_CHANGE_STATES).toEqual(["reported", "read_out", "closed", "abandoned"]);
  });

  test("the verdict column offers exactly the four ratified verdicts", () => {
    expect(shippedChangeVerdicts.verdict.enumValues).toEqual([...SHIPPED_VERDICTS]);
    expect(SHIPPED_VERDICTS).toEqual(["keep", "kill", "leave", "no_verdict_given"]);
  });
});

describe("one verdict per change is a database invariant", () => {
  test("the verdict index is unique over the organization and the change", () => {
    const index = indexNamed(shippedChangeVerdicts, VERDICT_INDEX);

    expect(index?.config.unique).toBe(true);
    expect(columnNamesOf(index)).toEqual(["organization_id", "change_id"]);
  });

  test("the recorded verdict and its timestamp are not null", () => {
    const columns = columnsByName(shippedChangeVerdicts);

    expect(columns.get("verdict")?.notNull).toBe(true);
    expect(columns.get("recorded_at")?.notNull).toBe(true);
  });
});
