"use client";

// The dialog/listbox/option pattern is what UX §9.1 specifies and what §9.2's keyboard map is
// built on; the tags oxlint prefers cannot carry two counts on a row.
/* oxlint-disable jsx-a11y/prefer-tag-over-role */
/* oxlint-disable jsx-a11y/no-noninteractive-element-to-interactive-role */
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions */

import { Button, Radio, Stack, Text, TextInput } from "@mantine/core";
import { useState, type KeyboardEvent } from "react";

import {
  REPLAY_CLEAR_SEARCH_ACTION,
  REPLAY_NOUN_MANY,
  REPLAY_NOUN_ONE,
  REPLAY_OPTION_COUNT_TEMPLATE,
  REPLAY_PANEL_CLEAR_LABEL,
  REPLAY_SEARCH_NO_MATCH_BODY,
} from "@growthmind/shared";

import { fill } from "../copy";
import classes from "./filter-bar.module.css";
import type { FilterDescriptor, FilterOption } from "./types";

// UX §9.1 puts both counts in the option's accessible name, because R-2 refuses to encode "this
// would give you nothing" in opacity and a screen reader never sees a colour. packages/shared
// carries the replay noun and no session noun; see the wave report.
const SESSION_NOUN_ONE = "session";
const SESSION_NOUN_MANY = "sessions";

interface FilterPanelProps {
  readonly id?: string;
  readonly descriptor: FilterDescriptor;
  readonly onPick: (value: string) => void;
  readonly onDismiss: () => void;
  readonly onClear?: () => void;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function countText(option: FilterOption): string | null {
  if (option.sessionCount === null || option.replayCount === null) return null;

  return fill(REPLAY_OPTION_COUNT_TEMPLATE, {
    sessions: String(option.sessionCount),
    replays: String(option.replayCount),
  });
}

function accessibleName(option: FilterOption): string {
  if (option.sessionCount === null || option.replayCount === null) return option.label;

  const sessions = plural(option.sessionCount, SESSION_NOUN_ONE, SESSION_NOUN_MANY);
  const replays = plural(option.replayCount, REPLAY_NOUN_ONE, REPLAY_NOUN_MANY);

  return `${option.label}, ${sessions}, ${replays}`;
}

export function FilterPanel({ id, descriptor, onPick, onDismiss, onClear }: FilterPanelProps) {
  const [query, setQuery] = useState("");

  const [panelWidth, panelHeight] = descriptor.panelSize;
  const axis = descriptor.summarise("").replace(/[\s:]+$/u, "");

  const needle = query.trim().toLowerCase();
  const matching = descriptor.options.filter((option) =>
    option.label.toLowerCase().includes(needle),
  );

  function dismissOnEscape(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") onDismiss();
  }

  function pickOnEnter(event: KeyboardEvent<HTMLLIElement>, value: string): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onPick(value);
  }

  return (
    <div
      id={id}
      role="dialog"
      aria-label={axis}
      className={classes.panel}
      style={{ width: panelWidth, height: panelHeight }}
      // React's client renderer routes a style object back through the browser's own
      // serialiser; writing the attribute on attach keeps the morph target exactly the two
      // numbers the descriptor states.
      ref={(node) => {
        node?.setAttribute(
          "style",
          `width:${String(panelWidth)}px;height:${String(panelHeight)}px`,
        );
      }}
      onKeyDown={dismissOnEscape}
    >
      {descriptor.kind === "segment" ? (
        <fieldset className={classes.fieldset}>
          <legend className={classes.legend}>{axis}</legend>

          <Radio.Group
            value={descriptor.value ?? descriptor.options[0]?.value ?? ""}
            onChange={onPick}
          >
            <Stack gap="xs" pt="xs">
              {descriptor.options.map((option) => (
                <Radio
                  key={option.value}
                  value={option.value}
                  label={
                    <span>
                      {option.label}
                      {countText(option) === null ? null : (
                        <Text span size="xs" c="dimmed" className={classes.count}>
                          {` · ${String(countText(option))}`}
                        </Text>
                      )}
                    </span>
                  }
                  description={option.description ?? undefined}
                />
              ))}
            </Stack>
          </Radio.Group>
        </fieldset>
      ) : (
        <>
          <TextInput
            size="xs"
            label={axis}
            labelProps={{ className: classes.hiddenLabel }}
            placeholder={descriptor.searchPlaceholder ?? undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />

          {matching.length === 0 && needle !== "" ? (
            <Stack gap="xs" align="flex-start">
              <Text size="sm">{fill(REPLAY_SEARCH_NO_MATCH_BODY, { query })}</Text>
              <Button
                variant="subtle"
                size="xs"
                onClick={() => {
                  setQuery("");
                }}
              >
                {REPLAY_CLEAR_SEARCH_ACTION}
              </Button>
            </Stack>
          ) : (
            <ul role="listbox" aria-label={axis} className={classes.options}>
              {matching.map((option) => (
                <li
                  key={option.value}
                  role="option"
                  aria-selected={option.value === descriptor.value}
                  aria-label={accessibleName(option)}
                  data-empty={option.sessionCount === 0 ? "true" : undefined}
                  tabIndex={0}
                  className={classes.optionRow}
                  onClick={() => {
                    onPick(option.value);
                  }}
                  onKeyDown={(event) => {
                    pickOnEnter(event, option.value);
                  }}
                >
                  <Text size="sm" truncate="end">
                    {option.label}
                  </Text>
                  {countText(option) === null ? null : (
                    <Text size="xs" c="dimmed" className={classes.count}>
                      {countText(option)}
                    </Text>
                  )}
                </li>
              ))}
            </ul>
          )}

          {descriptor.footNote === null ? null : (
            <Text size="xs" c="dimmed">
              {descriptor.footNote}
            </Text>
          )}
        </>
      )}

      {descriptor.value === null || onClear === undefined ? null : (
        <Button variant="subtle" size="xs" onClick={onClear}>
          {REPLAY_PANEL_CLEAR_LABEL}
        </Button>
      )}
    </div>
  );
}
