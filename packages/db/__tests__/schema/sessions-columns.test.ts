import { describe, expect, test } from "bun:test";

import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import { sessions } from "../../src/schema/sessions";

// Written out rather than derived from the table under test: a guard that reads its
// expectation from its subject asserts nothing. Decision 0020 ratified five nullable,
// no-default integer columns and nothing else, so a sixth entry here is a human call
// being widened.
const FROZEN_COLUMN_NAMES = [
  "connection_id",
  "created_at",
  "entry_url_path",
  "exclusion_reason",
  "exclusion_rule_set_version",
  "grouping_version",
  "id",
  "identity_email_domain",
  "identity_key",
  "identity_resolution",
  "internal_domain_at_stamp",
  "last_event_at",
  "organization_id",
  "origin",
  "project_id",
  "recording_active_seconds",
  "recording_click_count",
  "recording_console_error_count",
  "recording_duration_seconds",
  "recording_keypress_count",
  "session_key",
  "started_at",
  "updated_at",
  "user_agent",
] as const;

const RATIFIED_META_COLUMNS = [
  "recording_duration_seconds",
  "recording_active_seconds",
  "recording_click_count",
  "recording_keypress_count",
  "recording_console_error_count",
] as const;

// The indexes the table had before this sprint. The meta columns are stamped and rendered
// and filtered by nothing, so none of them earns an index here.
const FROZEN_INDEX_NAMES = [
  "sessions_project_session_key_uidx",
  "sessions_organization_id_idx",
  "sessions_project_started_at_idx",
  "sessions_connection_id_idx",
] as const;

const byName = (left: string, right: string): number => left.localeCompare(right);

function columnsByName(): Map<string, { notNull: boolean; hasDefault: boolean }> {
  return new Map(
    Object.values(getTableColumns(sessions)).map((column) => [
      column.name,
      { notNull: column.notNull, hasDefault: column.hasDefault },
    ]),
  );
}

describe("the sessions column set", () => {
  test("should expose exactly the columns the sessions table had before this sprint plus the five ratified meta columns", () => {
    const actual = [...columnsByName().keys()].toSorted();

    expect(actual).toEqual([...FROZEN_COLUMN_NAMES].toSorted());
  });

  test("should declare all five meta columns nullable with no default", () => {
    const columns = columnsByName();

    for (const name of RATIFIED_META_COLUMNS) {
      const column = columns.get(name);

      expect(column).toBeDefined();
      expect(column?.notNull).toBe(false);
      expect(column?.hasDefault).toBe(false);
    }
  });

  test("should add no index for the meta columns", () => {
    const actual = getTableConfig(sessions)
      .indexes.map((index) => index.config.name ?? "")
      .toSorted(byName);

    expect(actual).toEqual([...FROZEN_INDEX_NAMES].toSorted(byName));
  });
});
