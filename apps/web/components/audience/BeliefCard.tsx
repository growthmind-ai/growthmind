"use client";

import { Anchor, Button, Text, Textarea } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type RefObject } from "react";
import posthog from "posthog-js";

import { PAGES_SAVE_FAILED } from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";
import type { BeliefCardView } from "@/lib/audience/read";

import { SETTINGS_API, postJson, readRefusal } from "../first-run/api";
import styles from "./BeliefCard.module.css";
import { focusAtEnd } from "./caret";
import { DroppedNote } from "./DroppedNote";
import { FactChips } from "./FactChips";
import { MorphSurface, type MorphControls, type MorphPanelDescriptor } from "./MorphSurface";
import surface from "./MorphSurface.module.css";

type BeliefPanel = "correct" | "source";

const TOOLBAR_SIZE = { width: 228, height: 42 };
const CORRECT_SIZE = { width: 344, height: 258 };
const SOURCE_SIZE = { width: 330, height: 224 };

const CORRECT_HEADER = "Correct this belief";
const SOURCE_HEADER = "Where this came from";
const SAVED_CARD = "Saved — corrections outrank what we read ✓";

// Confirming changed nothing about the claim, so it may not report a correction: what it
// bought is that we now hold this as checked.
const SAVED_CONFIRM = "Confirmed — we'll treat this as checked ✓";
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

export interface BeliefCardProps {
  readonly card: BeliefCardView;

  // The tombstone is owned by the list, not by this card: the drop's own push refreshes the
  // page out from under it, and a card that held its own Undo lost it 250 ms later.
  readonly onDropped: () => void;
}

// Confirm carries no text, so a moved row cannot be retried into existence: the honest
// answer is the server's own reload sentence plus a re-read (AD-3, D3).
function ConfirmVerb({
  card,
  controls,
  onFailed,
}: {
  readonly card: BeliefCardView;
  readonly controls: MorphControls<BeliefPanel>;
  readonly onFailed: (message: string, refresh: boolean) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function confirm(): Promise<void> {
    setPending(true);
    onFailed("", false);

    const answer = await postJson(SETTINGS_API.businessConfirm, {
      kind: card.factKind,
      statement: card.claim,
    });

    setPending(false);

    if (answer === null || !answer.ok) {
      const refusal = readRefusal(answer?.body);
      onFailed(refusal?.message ?? PAGES_SAVE_FAILED, refusal?.code === "fact_not_found");
      return;
    }

    instrument(CONFIRMED_EVENT);
    controls.applied(SAVED_CONFIRM);
    router.refresh();
  }

  return (
    <Button
      size="compact-sm"
      variant="subtle"
      radius="xl"
      disabled={pending}
      onClick={() => void confirm()}
    >
      ✓ Confirm
    </Button>
  );
}

function CorrectEditor({
  card,
  controls,
  textareaRef,
  onDropped,
}: {
  readonly card: BeliefCardView;
  readonly controls: MorphControls<BeliefPanel>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly onDropped: () => void;
}) {
  const router = useRouter();
  const headerId = useId();
  const [draft, setDraft] = useState(card.claim);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, setPending] = useState<"save" | "drop" | null>(null);

  async function post(statement: string | null): Promise<boolean> {
    setPending(statement === null ? "drop" : "save");
    setFailed(null);

    const answer = await postJson(SETTINGS_API.businessFact, {
      kind: card.factKind,
      was: card.claim,
      statement,
    });

    setPending(null);

    if (answer !== null && answer.ok) return true;

    // The admission seam's sentence names what to change and is worth keeping; a moved
    // row, a dead transport, or exhausted contention all read as one retryable failure
    // with the text preserved (UX §5 write-failed).
    const refusal = readRefusal(answer?.body);
    if (statement !== null && refusal?.code === "fact_not_admitted") instrument(REFUSED_EVENT);
    setFailed(
      refusal === null || refusal.code === "fact_not_found" ? WRITE_FAILED : refusal.message,
    );
    return false;
  }

  async function save(): Promise<void> {
    const trimmed = draft.trim();

    // Refused before any request leaves the browser (FR-5, a-form-ships-complete).
    if (trimmed.length === 0) {
      setInvalid(EMPTY_CORRECTION);
      return;
    }
    if (trimmed === card.claim.trim()) {
      setInvalid(UNCHANGED_CORRECTION);
      return;
    }

    setInvalid(null);
    if (await post(trimmed)) {
      instrument(CORRECTED_EVENT);
      controls.applied(SAVED_CARD);
      router.refresh();
    }
  }

  async function drop(): Promise<void> {
    setInvalid(null);
    if (await post(null)) {
      instrument(DROPPED_EVENT);
      controls.dismiss();
      onDropped();
      // Safe to re-read now: the tombstone lives above this card, so the refresh replaces
      // the row without taking Undo with it.
      router.refresh();
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <Text component="span" id={headerId} size="xs" fw={700} tt="uppercase" c="dimmed">
          {CORRECT_HEADER}
        </Text>
        <Button size="compact-xs" variant="subtle" color="gray" onClick={controls.back}>
          ← back
        </Button>
      </div>
      <Textarea
        ref={textareaRef}
        rows={4}
        value={draft}
        aria-labelledby={headerId}
        placeholder="Say what's actually true — about the group, never a named person."
        classNames={{ input: invalid === null ? undefined : styles.warnInput }}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          setInvalid(null);
        }}
      />
      {invalid === null ? null : (
        <Text size="xs" c="orange">
          {invalid}
        </Text>
      )}
      <div className={styles.actions}>
        <Button size="compact-sm" disabled={pending !== null} onClick={() => void save()}>
          {pending === "save" ? "Saving…" : "Save correction"}
        </Button>
        <Button
          size="compact-xs"
          variant="subtle"
          color="red"
          ml="auto"
          disabled={pending !== null}
          onClick={() => void drop()}
        >
          Drop this belief
        </Button>
      </div>
      {failed === null ? null : (
        <Text size="xs" c="orange" component="output">
          {failed}
        </Text>
      )}
    </div>
  );
}

function SourcePanel({
  card,
  controls,
}: {
  readonly card: BeliefCardView;
  readonly controls: MorphControls<BeliefPanel>;
}) {
  const href = card.source.citationHref;

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <Text component="span" size="xs" fw={700} tt="uppercase" c="dimmed">
          {SOURCE_HEADER}
        </Text>
        <Button size="compact-xs" variant="subtle" color="gray" onClick={controls.back}>
          ← back
        </Button>
      </div>
      {href === null ? null : (
        <Anchor
          href={href}
          target="_blank"
          rel="noreferrer"
          size="sm"
          className={styles.cite}
          style={tapTargetStyle}
        >
          {href.replace(/^https?:\/\//, "")}
        </Anchor>
      )}
      {card.source.lines.map((line) => (
        <Text key={line} size="sm" c="dimmed">
          {line}
        </Text>
      ))}
    </div>
  );
}

// The struck-through prior is announced, never left to decoration alone (UX §9).
function CardBody({ card }: { readonly card: BeliefCardView }) {
  return (
    <div className={styles.body}>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">
        {card.label}
      </Text>
      <div className={styles.claimLine}>
        {/* The hidden label sits outside the strike: inside it, the announcement itself was
            struck through, so the only reader who needs the words got them crossed out. */}
        {card.prior === null ? null : (
          <Text component="span" c="dimmed">
            <span className={surface.srOnly}>previously believed: </span>
            <s>{card.prior}</s>
          </Text>
        )}
        <Text component="span" fw={600}>
          {card.claim}
        </Text>
        <FactChips chips={card.chips} />
      </div>
      <Text size="sm" c="dimmed">
        {card.evidence}
      </Text>
      <div className={styles.changed}>
        <Text component="span" size="xs" fw={700} tt="uppercase" c="dimmed">
          Changed{" "}
        </Text>
        <Text component="span" size="sm">
          {card.changed}
        </Text>
      </div>
      {card.settledBy === null ? null : (
        <div>
          <Text component="span" size="xs" fw={700} tt="uppercase" c="dimmed">
            Would be settled by{" "}
          </Text>
          <Text component="span" size="sm" c="dimmed">
            {card.settledBy}
          </Text>
        </div>
      )}
    </div>
  );
}

export interface DroppedBeliefCardProps {
  readonly card: BeliefCardView;
  readonly onRestored: () => void;
  readonly onDismiss: () => void;
}

export function DroppedBeliefCard({ card, onRestored, onDismiss }: DroppedBeliefCardProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Undo restores the sentence as the person's own statement — original research
  // provenance is gone with the tombstoned row, and re-minting it would fabricate a
  // receipt (AD-3, named in the PR body).
  async function undo(): Promise<void> {
    if (pending) return;
    setPending(true);
    setFailed(null);

    const answer = await postJson(SETTINGS_API.businessFact, {
      kind: card.factKind,
      was: null,
      statement: card.claim,
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
    <div className={styles.card}>
      <div className={styles.dimmed}>
        <CardBody card={card} />
      </div>
      <DroppedNote
        className={styles.dropNote}
        pending={pending}
        failed={failed}
        onUndo={() => void undo()}
        onDismiss={onDismiss}
      />
    </div>
  );
}

export function BeliefCard({ card, onDropped }: BeliefCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [confirmFailed, setConfirmFailed] = useState<string | null>(null);
  const router = useRouter();

  const hasSource = card.source.lines.length > 0;

  const panels: Record<BeliefPanel, MorphPanelDescriptor<BeliefPanel>> = {
    correct: {
      size: CORRECT_SIZE,
      label: CORRECT_HEADER,
      onOpened: () => focusAtEnd(textareaRef.current),
      render: (controls) => (
        <CorrectEditor
          key={card.claim}
          card={card}
          controls={controls}
          textareaRef={textareaRef}
          onDropped={onDropped}
        />
      ),
    },
    source: {
      size: SOURCE_SIZE,
      label: SOURCE_HEADER,
      render: (controls) => <SourcePanel card={card} controls={controls} />,
    },
  };

  // A render prop by MorphSurface's contract, not a nested component: the engine calls it
  // inline on its own render pass, so nothing here remounts between phases.
  const toolbar = (controls: MorphControls<BeliefPanel>) => (
    <>
      <ConfirmVerb
        card={card}
        controls={controls}
        onFailed={(message, refresh) => {
          setConfirmFailed(message === "" ? null : message);
          if (refresh) router.refresh();
        }}
      />
      <span className={surface.sep} aria-hidden="true" />
      <Button
        size="compact-sm"
        variant="subtle"
        radius="xl"
        onClick={() => controls.openPanel("correct")}
      >
        ✎ Correct
      </Button>
      {hasSource ? (
        <>
          <span className={surface.sep} aria-hidden="true" />
          <Button
            size="compact-sm"
            variant="subtle"
            radius="xl"
            onClick={() => controls.openPanel("source")}
          >
            ⌕ Source
          </Button>
        </>
      ) : null}
    </>
  );

  return (
    <MorphSurface<BeliefPanel>
      toolbarSize={TOOLBAR_SIZE}
      toolbarLabel="Confirm, correct, or check the source"
      className={styles.card}
      panels={panels}
      toolbar={toolbar}
    >
      <CardBody card={card} />
      {confirmFailed === null ? null : (
        <Text size="xs" c="red" component="output">
          {confirmFailed}
        </Text>
      )}
    </MorphSurface>
  );
}
