"use client";

import { Badge, Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import posthog from "posthog-js";

import { PAGES_SAVE_FAILED, STATEMENT_MAX } from "@growthmind/shared";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { RuledRow } from "@/components/ui/Page";
import type { FactRowView } from "@/lib/audience/read";

import { SETTINGS_API, postJson, readRefusal } from "../first-run/api";
import styles from "./FactRow.module.css";
import { MorphSurface, type MorphControls } from "./MorphSurface";
import morphStyles from "./MorphSurface.module.css";

// The confirm route is this sprint's one new sibling (AD-3); a shared constant is due once
// the concurrent descriptor wave lands.
const CONFIRM_ROUTE = "/api/settings/business/confirm";

const TOOLBAR_SIZE = { width: 176, height: 42 } as const;
const PANEL_SIZE = { width: 344, height: 258 } as const;

const ROW_SAVED = "Saved ✓";
const CORRECT_PANEL_LABEL = "Correct this";
const EMPTY_CORRECTION = "Write the correction first — an empty correction changes nothing.";
const UNCHANGED_CORRECTION = "Change something first — this is what we already believe.";
const WRITE_FAILED = "That didn't save. Your text is still here — try again.";
const DROPPED_NOTE = "Dropped — you said this is wrong.";

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

function chipProps(chip: string): { readonly variant: string; readonly color?: string } {
  if (chip === "assumed") return { variant: "outline" };
  if (chip.startsWith("confirmed")) return { variant: "light", color: "green" };
  if (chip === "observed" || chip.startsWith("corrected")) return { variant: "light" };
  return { variant: "default" };
}

type Pending = "confirm" | "save" | "drop" | "undo" | null;

export interface FactRowProps {
  readonly view: FactRowView;
}

// The arrive-with descriptor over the morph engine: Confirm and Correct only, provenance
// inline in the row, Drop living inside the correct panel (UX §2 object-type matrix).
export function FactRow({ view }: FactRowProps) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowNotice, setRowNotice] = useState<string | null>(null);
  const [dropped, setDropped] = useState(false);
  const [draft, setDraft] = useState(view.claim);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const panelHeadId = useId();

  async function confirm(controls: MorphControls<"correct">): Promise<void> {
    setPending("confirm");
    setRowNotice(null);

    const answer = await postJson(CONFIRM_ROUTE, {
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
      setDropped(true);
      controls.dismiss();
      return;
    }

    const refusal = readRefusal(answer?.body);
    setNotice(
      refusal === null || refusal.code === "fact_not_found" ? WRITE_FAILED : refusal.message,
    );
  }

  async function undo(): Promise<void> {
    setPending("undo");
    setRowNotice(null);

    const answer = await postJson(SETTINGS_API.businessFact, {
      kind: view.factKind,
      was: null,
      statement: view.claim,
    });

    setPending(null);

    if (answer !== null && answer.ok) {
      setDropped(false);
      router.refresh();
      return;
    }

    setRowNotice(readRefusal(answer?.body)?.message ?? PAGES_SAVE_FAILED);
  }

  const body = (
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
          {view.chips.map((chip) => (
            <Badge key={chip} {...chipProps(chip)} radius="sm" size="sm">
              {chip}
            </Badge>
          ))}
        </Group>
        <Text size="xs" c="dimmed">
          {view.evidence}
        </Text>
      </Stack>
    </RuledRow>
  );

  const failure =
    rowNotice === null ? null : (
      <Text size="xs" c="red" component="output">
        {rowNotice}
      </Text>
    );

  if (dropped) {
    return (
      <div>
        <div className={styles.droppedBody}>{body}</div>
        <Group gap="xs" align="center">
          <Text size="xs" c="dimmed">
            {DROPPED_NOTE}
          </Text>
          <Button
            size="compact-xs"
            variant="subtle"
            className={styles.tap}
            loading={pending === "undo"}
            onClick={() => void undo()}
          >
            Undo
          </Button>
        </Group>
        {failure}
      </div>
    );
  }

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
          <span className={morphStyles.sep} />
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
