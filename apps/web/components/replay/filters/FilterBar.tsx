"use client";

import { useMantineTheme } from "@mantine/core";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

import classes from "./filter-bar.module.css";
import { FilterPanel } from "./FilterPanel";
import type { FilterDescriptor } from "./types";

interface FilterBarProps {
  readonly descriptors: readonly FilterDescriptor[];
  readonly onApply: (param: string, value: string) => void;
  readonly onClear?: (param: string) => void;
  readonly label?: string;
}

interface FilterControlProps {
  readonly descriptor: FilterDescriptor;
  readonly open: boolean;
  readonly accented: CSSProperties;
  readonly onOpen: () => void;
  readonly onDismiss: () => void;
  readonly onApply: (param: string, value: string) => void;
  readonly onClear?: ((param: string) => void) | undefined;
}

// At rest a descriptor with nothing to choose between is an absence rather than an empty state.
// A value in the URL overrides that: a filter applied with no control to clear it is a dead end,
// and it is the one the URL can always create.
function isVisible(descriptor: FilterDescriptor): boolean {
  return descriptor.options.length > 1 || descriptor.value !== null;
}

function FilterControl({
  descriptor,
  open,
  accented,
  onOpen,
  onDismiss,
  onApply,
  onClear,
}: FilterControlProps) {
  const pill = useRef<HTMLButtonElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const axisId = useId();
  const labelId = useId();

  const applied = descriptor.value !== null;

  function dismiss(): void {
    pill.current?.focus();
    onDismiss();
  }

  useEffect(() => {
    if (!open) return;

    host.current
      ?.querySelector<HTMLElement>('input:not([type="hidden"]), [role="option"]')
      ?.focus();
  }, [open]);

  return (
    <div className={classes.slot} ref={host}>
      <button
        type="button"
        ref={pill}
        // Named by its own text nodes rather than by an aria-label or a title: session replay
        // masks text and cannot mask an attribute, and an applied value is the customer's own
        // (B-049). The axis carries the colon, so the two read as one sentence.
        aria-labelledby={applied ? `${axisId} ${labelId}` : labelId}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        data-variant={applied ? "filled" : "default"}
        className={classes.pill}
        style={applied ? accented : undefined}
        onClick={() => {
          if (open) {
            dismiss();
            return;
          }
          onOpen();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) dismiss();
        }}
      >
        {applied ? (
          <span id={axisId} className={classes.hiddenLabel}>
            {`${descriptor.axis}:`}
          </span>
        ) : null}
        <span id={labelId} className={classes.label}>
          {applied ? descriptor.value : descriptor.restLabel}
        </span>
        <span className={classes.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {applied ? (
        <button
          type="button"
          aria-label={descriptor.clearLabel}
          className={classes.clear}
          onClick={() => {
            onClear?.(descriptor.param);
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      ) : null}

      {open ? (
        <FilterPanel
          id={panelId}
          descriptor={descriptor}
          onPick={(value) => {
            onApply(descriptor.param, value);
            dismiss();
          }}
          onDismiss={dismiss}
          onClear={() => {
            onClear?.(descriptor.param);
            dismiss();
          }}
        />
      ) : null}
    </div>
  );
}

export function FilterBar({ descriptors, onApply, onClear, label }: FilterBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const theme = useMantineTheme();

  // The same pairing a filled Mantine control paints, taken from the theme's own resolver so the
  // accent cannot drift from the rest of the app and no colour is written here.
  const accent = theme.variantColorResolver({
    color: theme.primaryColor,
    theme,
    variant: "filled",
  });

  const accented = {
    "--button-bg": accent.background,
    "--button-color": accent.color,
  } as CSSProperties;

  useEffect(() => {
    if (open === null) return;

    function away(event: MouseEvent): void {
      if (root.current?.contains(event.target as Node) === true) return;
      setOpen(null);
    }

    document.addEventListener("mousedown", away);
    return () => {
      document.removeEventListener("mousedown", away);
    };
  }, [open]);

  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
    <div role="group" aria-label={label} className={classes.bar} ref={root}>
      {descriptors.filter(isVisible).map((descriptor) => (
        <FilterControl
          key={descriptor.param}
          descriptor={descriptor}
          open={open === descriptor.param}
          accented={accented}
          onOpen={() => {
            setOpen(descriptor.param);
          }}
          onDismiss={() => {
            setOpen(null);
          }}
          onApply={onApply}
          onClear={onClear}
        />
      ))}
    </div>
  );
}
