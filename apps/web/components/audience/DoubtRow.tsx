"use client";

import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import posthog from "posthog-js";

import { FACT_SAVE_ACTION, PAGES_SAVE_FAILED } from "@growthmind/shared";

import { SETTINGS_API, postJson, readRefusal } from "@/components/first-run/api";
import type { AudienceDoubtView } from "@/lib/audience/read";

import { MorphSurface, type MorphControls } from "./MorphSurface";

const ANSWER_VERB = "Answer this";

const SAVED_NOTE = "Saved — this reranks what we look at next ✓";

// Nothing is written for this one, so it may not say saved — but a panel that closes in
// silence is indistinguishable from a tap that missed.
const LEFT_OPEN_NOTE = "Left open — we'll keep asking.";

// A plain-English description of what happened, fired on the answer, not the attempt.
const ANSWERED_EVENT = "Answered a doubt on the audience page";

// Self-hosted installs run without an analytics key; an uninitialised capture would log a
// vendor warning on every click instead of staying quiet.
function instrument(event: string): void {
  if (posthog.__loaded) posthog.capture(event);
}

const TOOLBAR_SIZE = { width: 120, height: 42 } as const;

// Options alone take the contract's answer panel; the free-text variant borrows the
// correct-style panel's dimensions, as the UX spec says it should.
const OPTIONS_PANEL_SIZE = { width: 312, height: 196 } as const;
const FREE_TEXT_PANEL_SIZE = { width: 344, height: 258 } as const;

type AnswerPanelName = "answer";

type ProposalDoubt = Extract<AudienceDoubtView, { kind: "proposal" }>;
type StatedOnlyDoubt = Extract<AudienceDoubtView, { kind: "stated-only" }>;

export interface DoubtRowProps {
  readonly doubt: AudienceDoubtView;
}

export function DoubtRow({ doubt }: DoubtRowProps) {
  return doubt.kind === "proposal" ? (
    <ProposalDoubtRow doubt={doubt} />
  ) : (
    <StatedOnlyDoubtRow doubt={doubt} />
  );
}

function FailedNote({ failed }: { failed: string | null }) {
  if (failed === null) return null;

  return (
    <Text size="xs" c="red" component="output">
      {failed}
    </Text>
  );
}

function BackButton({
  controls,
  disabled,
}: {
  controls: MorphControls<AnswerPanelName>;
  disabled: boolean;
}) {
  return (
    <Button size="compact-xs" variant="subtle" onClick={controls.back} disabled={disabled}>
      ← back
    </Button>
  );
}

// Render props the engine calls as functions, never mounts as component types — hoisted
// so the lint rule against nested components does not mistake them for ones.
function answerToolbar(controls: MorphControls<AnswerPanelName>) {
  return (
    <Button size="compact-sm" variant="subtle" onClick={() => controls.openPanel("answer")}>
      {ANSWER_VERB}
    </Button>
  );
}

// A who_counts proposal is answered on the audience route: the decision is about the rule
// the model reduced the sentence to, never a new statement (AD-3).
function ProposalDoubtRow({ doubt }: { doubt: ProposalDoubt }) {
  const router = useRouter();
  const [pending, setPending] = useState<"confirm" | "reject" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  async function decide(
    controls: MorphControls<AnswerPanelName>,
    decision: "confirm" | "reject",
  ): Promise<void> {
    setPending(decision);
    setFailed(null);

    const answer = await postJson(SETTINGS_API.businessAudience, {
      statement: doubt.statement,
      decision,
    });

    setPending(null);

    if (answer === null || !answer.ok) {
      setFailed(readRefusal(answer?.body)?.message ?? PAGES_SAVE_FAILED);
      return;
    }

    instrument(ANSWERED_EVENT);
    controls.applied(SAVED_NOTE);
    router.refresh();
  }

  const renderAnswer = (controls: MorphControls<AnswerPanelName>) => (
    <Stack gap={6} p={10}>
      <Group justify="flex-end">
        <BackButton controls={controls} disabled={pending !== null} />
      </Group>
      <Button
        ref={firstOptionRef}
        size="compact-sm"
        variant="default"
        fullWidth
        justify="flex-start"
        loading={pending === "confirm"}
        disabled={pending !== null}
        onClick={() => void decide(controls, "confirm")}
      >
        {doubt.confirmLabel}
      </Button>
      <Button
        size="compact-sm"
        variant="default"
        fullWidth
        justify="flex-start"
        loading={pending === "reject"}
        disabled={pending !== null}
        onClick={() => void decide(controls, "reject")}
      >
        {doubt.rejectLabel}
      </Button>
      {/* An honest "we don't know" persists nothing: the doubt stays open, and the row
          says which of those two things happened rather than just vanishing. */}
      <Button
        size="compact-sm"
        variant="default"
        fullWidth
        justify="flex-start"
        disabled={pending !== null}
        onClick={() => controls.applied(LEFT_OPEN_NOTE)}
      >
        {doubt.unknownLabel}
      </Button>
      <FailedNote failed={failed} />
    </Stack>
  );

  return (
    <MorphSurface<AnswerPanelName>
      toolbarSize={TOOLBAR_SIZE}
      toolbarLabel={ANSWER_VERB}
      toolbar={answerToolbar}
      panels={{
        answer: {
          size: OPTIONS_PANEL_SIZE,
          label: doubt.text,
          onOpened: () => firstOptionRef.current?.focus(),
          render: renderAnswer,
        },
      }}
    >
      <Text size="sm">{doubt.text}</Text>
    </MorphSurface>
  );
}

// An empty stated-only kind is answered on the fact route as an addition: the one-tap
// label or the typed sentence becomes a stated_by_customer fact of that kind (AD-3).
function StatedOnlyDoubtRow({ doubt }: { doubt: StatedOnlyDoubt }) {
  const router = useRouter();
  const promptId = useId();
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<"one-tap" | "free-text" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const oneTapRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function state(
    controls: MorphControls<AnswerPanelName>,
    source: "one-tap" | "free-text",
    statement: string,
  ): Promise<void> {
    setPending(source);
    setFailed(null);

    const answer = await postJson(SETTINGS_API.businessFact, {
      kind: doubt.factKind,
      was: null,
      statement,
    });

    setPending(null);

    if (answer === null || !answer.ok) {
      // The seam's own sentence when it has one: it names what to change, which a
      // generic failure would throw away. The typed text stays in the box either way.
      setFailed(readRefusal(answer?.body)?.message ?? PAGES_SAVE_FAILED);
      return;
    }

    instrument(ANSWERED_EVENT);
    controls.applied(SAVED_NOTE);
    router.refresh();
  }

  const trimmed = draft.trim();
  const oneTap = doubt.oneTap;

  const renderAnswer = (controls: MorphControls<AnswerPanelName>) => (
    <Stack gap={6} p={10}>
      <Group justify="space-between" align="flex-start" gap={8} wrap="nowrap">
        <Text id={promptId} size="sm" fw={600}>
          {doubt.freeTextPrompt}
        </Text>
        <BackButton controls={controls} disabled={pending !== null} />
      </Group>
      {oneTap === null ? null : (
        <Button
          ref={oneTapRef}
          size="compact-sm"
          variant="default"
          fullWidth
          justify="flex-start"
          loading={pending === "one-tap"}
          disabled={pending !== null}
          onClick={() => void state(controls, "one-tap", oneTap)}
        >
          {oneTap}
        </Button>
      )}
      <Textarea
        ref={textareaRef}
        aria-labelledby={promptId}
        // A static literal, not a binding: the replay-attribute register counts interpolated
        // placeholder values, and this one must stay provably our copy.
        placeholder="Say what's actually true — about the group, never a named person."
        autosize
        minRows={2}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
      />
      <Group justify="flex-end">
        <Button
          size="compact-sm"
          loading={pending === "free-text"}
          // An empty answer never leaves the browser: the button is the gate.
          disabled={pending !== null || trimmed.length === 0}
          onClick={() => void state(controls, "free-text", trimmed)}
        >
          {FACT_SAVE_ACTION}
        </Button>
      </Group>
      <FailedNote failed={failed} />
    </Stack>
  );

  return (
    <MorphSurface<AnswerPanelName>
      toolbarSize={TOOLBAR_SIZE}
      toolbarLabel={ANSWER_VERB}
      toolbar={answerToolbar}
      panels={{
        answer: {
          size: FREE_TEXT_PANEL_SIZE,
          label: doubt.freeTextPrompt,
          onOpened: () => (oneTap !== null ? oneTapRef.current : textareaRef.current)?.focus(),
          render: renderAnswer,
        },
      }}
    >
      <Stack gap={2}>
        <Text size="xs" c="dimmed">
          {doubt.label}
        </Text>
        <Text size="sm">{doubt.text}</Text>
      </Stack>
    </MorphSurface>
  );
}
