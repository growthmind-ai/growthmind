"use client";

import { Checkbox, Group, Select, Stack, Text } from "@mantine/core";
import { useState } from "react";

import {
  PAGES_CHANGEABLE_LABEL,
  PAGES_CONFIRMED_BY_A_PERSON,
  PAGES_NONE_YET,
  PAGES_NONE_YET_NO_SOURCE,
  PAGES_OFF_LIMITS_NOTE,
  PAGES_OUR_GUESS,
  PAGES_ROLE_CHOICES,
  PAGES_SAVE_FAILED,
  PAGES_SAVED,
  PAGES_SECTION_LEAD,
  type SurfaceRole,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";
import type { PageRoleView } from "@/lib/settings/pages";

import { SETTINGS_API, postJson } from "../first-run/api";

const CHOICES = PAGES_ROLE_CHOICES.map((choice) => ({
  value: choice.value,
  label: choice.label,
}));

interface PageRolesProps {
  readonly pages: readonly PageRoleView[];

  // With nothing attached this table can never fill, so the empty state must not promise
  // that it will.
  readonly sourceAttached: boolean;
}

interface RowState {
  readonly role: SurfaceRole;
  readonly changeable: boolean;
  readonly statedByAPerson: boolean;
}

export function PageRoles({ pages, sourceAttached }: PageRolesProps) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      pages.map((page) => [
        page.surface,
        { role: page.role, changeable: page.changeable, statedByAPerson: page.statedByAPerson },
      ]),
    ),
  );
  // Per row, not per section: with ten rows a single banner leaves a reader guessing which
  // control it belongs to.
  const [notice, setNotice] = useState<Record<string, "saved" | "failed">>({});

  if (pages.length === 0) {
    return <Text c="dimmed">{sourceAttached ? PAGES_NONE_YET : PAGES_NONE_YET_NO_SOURCE}</Text>;
  }

  async function state(surface: string, next: RowState): Promise<void> {
    const previous = rows[surface];
    setRows((current) => ({ ...current, [surface]: next }));
    setNotice((current) => {
      const { [surface]: _cleared, ...rest } = current;
      return rest;
    });

    const answer = await postJson(SETTINGS_API.pageRole, {
      surface,
      role: next.role,
      changeable: next.changeable,
    });

    if (answer === null || !answer.ok) {
      // Put the control back to what the server still holds, so the screen never shows an
      // answer nobody recorded.
      setNotice((current) => ({ ...current, [surface]: "failed" }));
      if (previous !== undefined) {
        setRows((current) => ({ ...current, [surface]: previous }));
      }
      return;
    }

    setRows((current) => ({
      ...current,
      [surface]: { ...next, statedByAPerson: true },
    }));
    // Said out loud every time, not only the first: after the marker already reads "You said
    // so", a second correction would otherwise land with no acknowledgement at all.
    setNotice((current) => ({ ...current, [surface]: "saved" }));
  }

  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        {PAGES_SECTION_LEAD}
      </Text>

      {pages.map((page) => {
        const row = rows[page.surface] ?? {
          role: page.role,
          changeable: page.changeable,
          statedByAPerson: page.statedByAPerson,
        };

        return (
          <Stack key={page.surface} gap={4}>
            <Group gap="sm" wrap="wrap" align="center">
              <Text ff="monospace" size="sm" style={{ minWidth: 180 }}>
                {page.surface}
              </Text>

              <Select
                data={CHOICES}
                value={row.role}
                aria-label={`What ${page.surface} is for`}
                allowDeselect={false}
                onChange={(value) => {
                  if (value === null) return;
                  void state(page.surface, { ...row, role: value as SurfaceRole });
                }}
                style={{ ...tapTargetStyle, minWidth: 280 }}
              />

              <Text size="xs" c="dimmed">
                {row.statedByAPerson ? PAGES_CONFIRMED_BY_A_PERSON : PAGES_OUR_GUESS}
              </Text>

              {notice[page.surface] === undefined ? null : (
                <Text
                  component="output"
                  size="xs"
                  c={notice[page.surface] === "failed" ? "red" : "dimmed"}
                >
                  {notice[page.surface] === "failed" ? PAGES_SAVE_FAILED : PAGES_SAVED}
                </Text>
              )}
            </Group>

            {page.offLimits ? (
              <Group gap="xs" align="flex-start" pl="xs">
                <Checkbox
                  checked={row.changeable}
                  label={PAGES_CHANGEABLE_LABEL}
                  aria-label={`${PAGES_CHANGEABLE_LABEL}: ${page.surface}`}
                  onChange={(event) => {
                    void state(page.surface, { ...row, changeable: event.currentTarget.checked });
                  }}
                  style={tapTargetStyle}
                />
                <Text size="xs" c="dimmed">
                  {PAGES_OFF_LIMITS_NOTE}
                </Text>
              </Group>
            ) : null}
          </Stack>
        );
      })}
    </Stack>
  );
}
