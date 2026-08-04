"use client";

import { Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  BELIEF_CANCEL_ACTION,
  BELIEF_CORRECT_ACTION,
  BELIEF_CORRECTED_NOTE,
  BELIEF_EDIT_LABEL,
  BELIEF_REMOVE_ACTION,
  BELIEF_SAVE_ACTION,
  PAGES_SAVE_FAILED,
  SITE_READ_FROM,
  SITE_TOLD_TO_US,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";
import type { SiteBeliefView } from "@/lib/settings/site";

import { SETTINGS_API, postJson, readRefusal } from "../first-run/api";

interface BeliefRowProps {
  readonly belief: SiteBeliefView;
}

export function BeliefRow({ belief }: BeliefRowProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(belief.statement);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function send(statement: string | null): Promise<void> {
    setPending(true);
    setFailed(null);

    const answer = await postJson(SETTINGS_API.belief, {
      kind: belief.kind,
      was: belief.statement,
      statement,
    });

    setPending(false);

    if (answer === null || !answer.ok) {
      // The server's own sentence when it has one — it says why a name was refused, which
      // a generic failure would throw away.
      setFailed(readRefusal(answer?.body)?.message ?? PAGES_SAVE_FAILED);
      return;
    }

    setEditing(false);
    router.refresh();
  }

  if (editing) {
    return (
      <Stack gap={4}>
        <TextInput
          label={BELIEF_EDIT_LABEL}
          value={draft}
          onChange={(event) => setDraft(event.currentTarget.value)}
          style={tapTargetStyle}
        />
        <Group gap="xs">
          <Button
            size="compact-sm"
            onClick={() => void send(draft.trim())}
            loading={pending}
            disabled={draft.trim().length === 0 || draft.trim() === belief.statement}
            style={tapTargetStyle}
          >
            {BELIEF_SAVE_ACTION}
          </Button>
          <Button
            size="compact-sm"
            variant="subtle"
            onClick={() => {
              setDraft(belief.statement);
              setEditing(false);
              setFailed(null);
            }}
            style={tapTargetStyle}
          >
            {BELIEF_CANCEL_ACTION}
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

  return (
    <Stack gap={0}>
      <Text size="sm">{belief.statement}</Text>

      <Group gap="xs" wrap="wrap">
        {/* Provenance beside the claim, always. A corrected row says so — O-036 calls these
            the highest-signal rows in the table, and hiding that flattens them. */}
        <Text size="xs" c="dimmed">
          {belief.correctedFrom !== null
            ? BELIEF_CORRECTED_NOTE
            : belief.readFrom === null
              ? SITE_TOLD_TO_US
              : `${SITE_READ_FROM} ${belief.readFrom}`}
        </Text>

        <Button
          size="compact-xs"
          variant="subtle"
          onClick={() => setEditing(true)}
          style={tapTargetStyle}
        >
          {BELIEF_CORRECT_ACTION}
        </Button>
        <Button
          size="compact-xs"
          variant="subtle"
          color="red"
          onClick={() => void send(null)}
          loading={pending}
          style={tapTargetStyle}
        >
          {BELIEF_REMOVE_ACTION}
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
