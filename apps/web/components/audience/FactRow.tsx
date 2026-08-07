"use client";

import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import posthog from "posthog-js";

import { PAGES_SAVE_FAILED, STATEMENT_MAX } from "@growthmind/shared";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { RuledRow } from "@/components/ui/Page";
import type { FactRowView } from "@/lib/audience/read";

import { SETTINGS_API, postJson, readRefusal } from "../first-run/api";
import { DroppedNote } from "./DroppedNote";
import { FactChips } from "./FactChips";
import styles from "./FactRow.module.css";
import { MorphSurface, type MorphControls } from "./MorphSurface";
import morphStyles from "./MorphSurface.module.css";

const TOOLBAR_SIZE = { width: 176, height: 42 } as const;
const PANEL_SIZE = { width: 344, height: 258 } as const;

const ROW_SAVED = "Saved ✓";
const CORRECT_PANEL_LABEL = "Correct this";
const EMPTY_CORRECTION = "Write the correction first — an empty correction changes nothing.";
const UNCHANGED_CORRECTION = "Change something first — this is what we already believe.";
const WRITE_FAILED = "That didn't save. Your text is still here — try again.";

// Plain-English descriptions of what happened, fired on the fact, not the attempt.
const CONFIRMED_EVENT = "Confirmed a belief on the audience page";
const CORRECTED_EVENT = "Corrected a belief on the audience page";
const DROPPED_EVENT = "Dropped a belief on the audience page";
const REFUSED_EVENT = "A correction was refused before saving";

// Self-hosted installs run without an analytics key; an uninitialised capture would log a
// vendor warning on every click instead of staying quiet.
function instrument(event: string): void {
  if (posthog.__loaded) posthog.capture(event);
}

type Pending = "confirm" | "save" | "drop" | null;

export interface FactRowProps {
  readonly view: FactRowView;

  // The tombstone is owned by the list, not by this row: the drop's own push refreshes the
  // page out from under it, and a row that held its own Undo lost it 250 ms later.
  readonly onDropped: () => void;
}

// The hidden label sits outside the strike: inside it, the announcement itself would be
// struck through for the only reader who needs the words.
function RowBody({ view }: { readonly view: FactRowView }) {
  return (
    <RuledRow lead={<Eyebrow>{view.label}</Eyebrow>} leadWidth={170}>
      <Stack gap={4}>
        <Group gap="xs" align="center" wrap="wrap">
          <Text size="sm">
            {view.prior === null ? null : (
              <>
                <span className={morphStyles.srOnly}>previously believed: </span>
                <s className={styles.prior}>{view.prior}</s>
              </>
            )}
            {view.claim}
          </Text>
          <FactChips chips={view.chips} />
        </Group>
        <Text size="xs" c="dimmed">
          {view.evidence}
        </Text>
      </Stack>
    </RuledRow>
  );
}

export interface DroppedFactRowProps {
  readonly view: FactRowView;
  readonly onRestored: () => void;
  readonly onDismiss: () => void;
}

// Undo restores the sentence as the person's own statement: the tombstoned row took its
// research provenance with it, and re-minting one would fabricate a receipt (AD-3).
export function DroppedFactRow({ view, onRestored, onDismiss }: DroppedFactRowProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function undo(): Promise<void> {
    if (pending) return;
    setPending(true);
    setFailed(null);

    const answer = await postJson(SETTINGS_API.businessFact, {
      kind: view.factKind,
      was: null,
      statement: view.claim,
    });

    setPending(false);

    if (answer === null || !answer.ok) {
      setFailed(readRefusal(answer?.body)?.message ?? PAGES_SAVE_FAILED);
      return;
    }

    onRestored();
    router.refresh();
  }

  return (
    <div>
      <div className={styles.droppedBody}>
        <RowBody view={view} />
      </div>
      <DroppedNote
        pending={pending}
        failed={failed}
        onUndo={() => void undo()}
        onDismiss={onDismiss}
      />
    </div>
  );
}

// The arrive-with descriptor over the morph engine: Confirm and Correct only, provenance
// inline in the row, Drop living inside the correct panel (UX §2 object-type matrix).
export function FactRow({ view, onDropped }: FactRowProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState(view.claim);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const panelHeadId = useId();

  async function confirm(controls: MorphControls<"correct">): Promise<void> {
    setPending("confirm");
    setRowNotice(null);

    const answer = await postJson(SETTINGS_API.businessConfirm, {
      kind: view.factKind,
      statement: view.claim,
    });

    setPending(null);

    if (answer !== null && answer.ok) {
      instrument(CONFIRMED_EVENT);
      controls.applied(ROW_SAVED);
      router.refresh();
      return;
    }

    const refusal = readRefusal(answer?.body);

    // The fact moved under the browser: show the server's reload sentence and re-read.
    if (refusal?.code === "fact_not_found") {
      setRowNotice(refusal.message);
      router.refresh();
      return;
    }

    setRowNotice(refusal?.message ?? PAGES_SAVE_FAILED);
  }

  async function save(controls: MorphControls<"correct">): Promise<void> {
    const trimmed = draft.trim();

    if (trimmed.length === 0) {
      setNotice(EMPTY_CORRECTION);
      return;
    }
    if (trimmed === view.claim) {
      setNotice(UNCHANGED_CORRECTION);
      return;
    }

    setPending("save");
    setNotice(null);

    const answer = await postJson(SETTINGS_API.businessFact, {
      kind: view.factKind,
      was: view.claim,
      statement: trimmed,
    });

    setPending(null);

    if (answer !== null && answer.ok) {
      instrument(CORRECTED_EVENT);
      controls.applied(ROW_SAVED);
      router.refresh();
      return;
    }

    const refusal = readRefusal(answer?.body);
    if (refusal?.code === "fact_not_admitted") instrument(REFUSED_EVENT);

    // Network loss, a 5xx, and contention exhaustion all land on the same honest state:
    // panel open, text preserved, try again (UX §5).
    if (refusal === null || refusal.code === "fact_not_found") {
      setNotice(WRITE_FAILED);
      return;
    }

    setNotice(refusal.message);
  }

  async function drop(controls: MorphControls<"correct">): Promise<void> {
    setPending("drop");
    setNotice(null);

    const answer = await postJson(SETTINGS_API.businessFact, {
      kind: view.factKind,
      was: view.claim,
      statement: null,
    });

    setPending(null);

    if (answer !== null && answer.ok) {
      instrument(DROPPED_EVENT);
      controls.dismiss();
      onDropped();
      // Safe to re-read now: the tombstone lives above this row, so the refresh replaces
      // the row without taking Undo with it.
      router.refresh();
      return;
    }

    const refusal = readRefusal(answer?.body);
    setNotice(
      refusal === null || refusal.code === "fact_not_found" ? WRITE_FAILED : refusal.message,
    );
  }

  const body = <RowBody view={view} />;

  const failure =
    rowNotice === null ? null : (
      <Text size="xs" c="red" component="output">
        {rowNotice}
      </Text>
    );

  return (
    <MorphSurface
      toolbarSize={TOOLBAR_SIZE}
      toolbarLabel="Confirm or correct this"
      // The engine's contract is render props called with its controls, never mounted as
      // elements, so no component identity exists to destabilise.
      // oxlint-disable-next-line react/no-unstable-nested-components
      toolbar={(controls) => (
        <>
          <Button
            size="compact-sm"
            variant="subtle"
            loading={pending === "confirm"}
            disabled={pending !== null}
            onClick={() => void confirm(controls)}
          >
            ✓ Confirm
          </Button>
          <span className={morphStyles.sep} aria-hidden="true" />
          <Button
            size="compact-sm"
            variant="subtle"
            disabled={pending !== null}
            onClick={() => {
              setDraft(view.claim);
              setNotice(null);
              controls.openPanel("correct");
            }}
          >
            ✎ Correct
          </Button>
        </>
      )}
      panels={{
        correct: {
          size: PANEL_SIZE,
          label: CORRECT_PANEL_LABEL,
          onOpened: () => editorRef.current?.focus(),
          // Same render-prop contract as the toolbar above.
          // oxlint-disable-next-line react/no-unstable-nested-components
          render: (controls) => (
            <div className={styles.panel}>
              <Group justify="space-between" align="center" gap="xs">
                <Text fw={600} size="sm" id={panelHeadId}>
                  {CORRECT_PANEL_LABEL}
                </Text>
                <Button size="compact-xs" variant="subtle" onClick={controls.back}>
                  ← back
                </Button>
              </Group>
              <Textarea
                ref={editorRef}
                classNames={{
                  root: styles.editor,
                  wrapper: styles.editor,
                  input: styles.editorInput,
                }}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                placeholder="Say what's actually true — about the group, never a named person."
                maxLength={STATEMENT_MAX}
                error={notice}
                aria-labelledby={panelHeadId}
              />
              <Group justify="space-between" gap="xs">
                <Button
                  size="compact-sm"
                  disabled={pending !== null}
                  onClick={() => void save(controls)}
                >
                  {pending === "save" ? "Saving…" : "Save correction"}
                </Button>
                <Button
                  size="compact-sm"
                  variant="subtle"
                  color="red"
                  loading={pending === "drop"}
                  disabled={pending !== null}
                  onClick={() => void drop(controls)}
                >
                  Drop this
                </Button>
              </Group>
            </div>
          ),
        },
      }}
    >
      {body}
      {failure}
    </MorphSurface>
  );
}
