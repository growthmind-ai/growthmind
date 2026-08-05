"use client";

import { Button, Group, Stack, Text, Textarea, UnstyledButton } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import {
  AUDIENCE_CONFIRM_ACTION,
  AUDIENCE_CONFIRMED_NOTE,
  AUDIENCE_PROPOSAL_LEAD,
  AUDIENCE_REJECT_ACTION,
  AUDIENCE_REJECTED_NOTE,
  AUDIENCE_UNCONFIRMED_NOTE,
  FACT_ADD_ACTION,
  FACT_ADD_LABEL,
  FACT_CANCEL_ACTION,
  FACT_CORRECTED_NOTE,
  FACT_EDIT_LABEL,
  FACT_REMOVE_ACTION,
  FACT_SAVE_ACTION,
  PAGES_SAVE_FAILED,
  type BusinessFactKind,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";
import type { StatedFactView } from "@/lib/settings/business";

import { SETTINGS_API, postJson, readRefusal } from "../first-run/api";
import classes from "./FactRow.module.css";

interface EditorProps {
  readonly kind: BusinessFactKind;

  // Null is an addition: there is no earlier statement to replace.
  readonly was: string | null;

  readonly label: string;
  readonly removable: boolean;
  readonly onDone: () => void;
}

function FactEditor({ kind, was, label, removable, onDone }: EditorProps) {
  const router = useRouter();
  const [draft, setDraft] = useState(was ?? "");
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // Focus follows the click that opened the editor, so the caret is where the person just
  // pressed. A stable callback, or every keystroke would re-attach the ref and re-focus.
  const focusOnMount = useCallback((node: HTMLTextAreaElement | null) => {
    node?.focus();
  }, []);

  const trimmed = draft.trim();

  // Null removes. Removal reads `was` rather than the draft, so an emptied box is never
  // itself a delete — the button is.
  async function send(statement: string | null): Promise<void> {
    setPending(statement === null ? "remove" : "save");
    setFailed(null);

    const answer = await postJson(SETTINGS_API.businessFact, { kind, was, statement });

    setPending(null);

    if (answer === null || !answer.ok) {
      // The server's own sentence when it has one — it says why a name was refused, or that
      // this kind is full, which a generic failure would throw away.
      setFailed(readRefusal(answer?.body)?.message ?? PAGES_SAVE_FAILED);
      return;
    }

    onDone();
    router.refresh();
  }

  const nothingToSave = trimmed.length === 0 || trimmed === (was ?? "");

  return (
    <Stack gap={4}>
      <Textarea
        autosize
        ref={focusOnMount}
        minRows={1}
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone();
        }}
        style={tapTargetStyle}
      />
      <Group gap="xs">
        <Button
          size="compact-sm"
          onClick={() => void send(trimmed)}
          loading={pending === "save"}
          disabled={pending !== null || nothingToSave}
          style={tapTargetStyle}
        >
          {FACT_SAVE_ACTION}
        </Button>
        <Button
          size="compact-sm"
          variant="subtle"
          onClick={onDone}
          disabled={pending !== null}
          style={tapTargetStyle}
        >
          {FACT_CANCEL_ACTION}
        </Button>
        {/* Away from Save and Cancel: it is the one control here that destroys something. */}
        {removable ? (
          <Button
            size="compact-sm"
            variant="subtle"
            color="red"
            ml="auto"
            onClick={() => void send(null)}
            loading={pending === "remove"}
            disabled={pending !== null}
            style={tapTargetStyle}
          >
            {FACT_REMOVE_ACTION}
          </Button>
        ) : null}
      </Group>
      {failed === null ? null : (
        <Text size="xs" c="red" component="output">
          {failed}
        </Text>
      )}
    </Stack>
  );
}

// The proposed rule, and what it is doing right now. An unanswered proposal narrows nothing,
// and the note says so — a screen that implied otherwise would have someone reading a
// finding against a denominator they believe they set.
function AudienceProposal({ fact }: { fact: StatedFactView }) {
  const router = useRouter();
  const [pending, setPending] = useState<"confirm" | "reject" | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const audience = fact.audience;
  if (audience === null) return null;

  async function decide(decision: "confirm" | "reject"): Promise<void> {
    setPending(decision);
    setFailed(null);

    const answer = await postJson(SETTINGS_API.businessAudience, {
      statement: fact.statement,
      decision,
    });

    setPending(null);

    if (answer === null || !answer.ok) {
      setFailed(readRefusal(answer?.body)?.message ?? PAGES_SAVE_FAILED);
      return;
    }

    router.refresh();
  }

  const note =
    audience.status === "confirmed"
      ? AUDIENCE_CONFIRMED_NOTE
      : audience.status === "rejected"
        ? AUDIENCE_REJECTED_NOTE
        : AUDIENCE_UNCONFIRMED_NOTE;

  return (
    <Stack gap={2} mt={4}>
      <Text size="xs" c="dimmed">
        {AUDIENCE_PROPOSAL_LEAD}
      </Text>
      <Text size="sm">{audience.sentence}</Text>
      <Text size="xs" c="dimmed">
        {note}
      </Text>

      {/* Both answers stay offered after a decision: changing your mind about who counts is
          the same act as deciding it the first time. */}
      <Group gap={4}>
        <Button
          size="compact-xs"
          variant={audience.status === "confirmed" ? "filled" : "subtle"}
          loading={pending === "confirm"}
          onClick={() => void decide("confirm")}
          style={tapTargetStyle}
        >
          {AUDIENCE_CONFIRM_ACTION}
        </Button>
        <Button
          size="compact-xs"
          variant={audience.status === "rejected" ? "filled" : "subtle"}
          loading={pending === "reject"}
          onClick={() => void decide("reject")}
          style={tapTargetStyle}
        >
          {AUDIENCE_REJECT_ACTION}
        </Button>
      </Group>

      {failed === null ? null : (
        <Text size="xs" c="red" component="output">
          {failed}
        </Text>
      )}
    </Stack>
  );
}

export function FactRow({ fact }: { fact: StatedFactView }) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <FactEditor
        kind={fact.kind}
        was={fact.statement}
        label={FACT_EDIT_LABEL}
        removable
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <Stack gap={0}>
      {/* A button rather than a click handler on the text: this is the only way to change a
          fact now, so it has to be reachable from a keyboard. */}
      <UnstyledButton className={classes.statement} onClick={() => setEditing(true)}>
        <Text size="sm">{fact.statement}</Text>
      </UnstyledButton>

      {/* The page a fact was read from is the same page for every row, and saying so five
          times was most of the noise. A correction is the row worth marking (O-036). */}
      {fact.correctedFrom === null ? null : (
        <Text size="xs" c="dimmed">
          {FACT_CORRECTED_NOTE}
        </Text>
      )}

      <AudienceProposal fact={fact} />
    </Stack>
  );
}

export function AddFact({ kind }: { kind: BusinessFactKind }) {
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <FactEditor
        kind={kind}
        was={null}
        label={FACT_ADD_LABEL}
        removable={false}
        onDone={() => setOpen(false)}
      />
    );
  }

  return (
    <Button
      size="compact-xs"
      variant="subtle"
      onClick={() => setOpen(true)}
      style={{ ...tapTargetStyle, alignSelf: "flex-start" }}
    >
      {FACT_ADD_ACTION}
    </Button>
  );
}
