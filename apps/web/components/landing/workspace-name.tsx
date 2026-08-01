"use client";

import { ActionIcon, Button, Group, TextInput, Title } from "@mantine/core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { tapTargetStyle } from "@/components/ui/tap-target";
import { renameWorkspace } from "@/lib/actions/workspace";

// P1 rename (UX spec. The "Rename state machine", normative). Four states: display ->
// editing -> saving -> (display | error). This is the one non-static element on the
// landing page; the interaction storyboard was deliberately skipped because this is a
// stock pattern fully specified there, so build against that table exactly rather than
// re-inventing it.
type Mode = "display" | "editing" | "saving" | "error";

const EMPTY_NAME_MESSAGE = "Give your workspace a name — anything works.";

// The 44px tap target now has ONE home (`components/ui/tap-target.ts`). This
// file held the original module-private copy; O-008's surface needed the same
// object on six more controls, and six copies is where a convention stops
// being one.

interface WorkspaceNameProps {
  initialName: string;
}

export function WorkspaceName({ initialName }: WorkspaceNameProps) {
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [mode, setMode] = useState<Mode>("display");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Increments exactly once per genuine "enter editing from display" event (never on
  // the editing -> saving -> error transitions that reuse the same mounted input). The
  // focus effect below keys off this, not off `mode`, so it fires once per session
  // rather than on every keystroke.
  const [editSession, setEditSession] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);

  // Focus contract (UX, binding): entering `editing` focuses the input with its text
  // selected. Exits are handled imperatively at the call site below (no focus trap.
  // This isn't a modal), since each exit already knows the exact moment it happens.
  useEffect(() => {
    if (editSession === 0) {
      return;
    }
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editSession]);

  function enterEditing() {
    setDraft(name);
    setErrorMessage(null);
    setMode("editing");
    setEditSession((session) => session + 1);
  }

  function returnToDisplay(nextName?: string) {
    if (nextName !== undefined) {
      setName(nextName);
    }
    setDraft(nextName ?? name);
    setErrorMessage(null);
    setMode("display");
    editButtonRef.current?.focus();
  }

  function handleCancel() {
    returnToDisplay();
  }

  async function handleSave() {
    const trimmed = draft.trim();
    if (!trimmed) {
      // Client-side reject before any network round trip. No spinner flash for
      // something already knowable from the input alone.
      setErrorMessage(EMPTY_NAME_MESSAGE);
      setMode("error");
      return;
    }

    setMode("saving");
    setErrorMessage(null);

    const result = await renameWorkspace(trimmed);
    if (result.ok) {
      returnToDisplay(result.name);
      return;
    }

    setErrorMessage(result.error);
    setMode("error");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (mode === "saving") {
      return;
    }
    if (event.key === "Escape") {
      handleCancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void handleSave();
    }
  }

  if (mode === "display") {
    return (
      <Group gap="xs" wrap="wrap" align="center">
        <Title order={1}>{name}</Title>
        <ActionIcon
          ref={editButtonRef}
          variant="subtle"
          color="gray"
          size="lg"
          aria-label="Rename workspace"
          onClick={enterEditing}
          style={tapTargetStyle}
        >
          <span aria-hidden>✎</span>
        </ActionIcon>
      </Group>
    );
  }

  const isSaving = mode === "saving";

  return (
    <Group gap="xs" wrap="wrap" align="flex-start">
      <TextInput
        ref={inputRef}
        aria-label="Workspace name"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        disabled={isSaving}
        error={mode === "error" ? errorMessage : undefined}
        size="lg"
        style={{ flex: "1 1 240px", minWidth: 0 }}
        styles={{ input: { fontWeight: 700 } }}
      />
      <Group gap="xs" wrap="nowrap">
        <Button size="sm" loading={isSaving} disabled={isSaving} onClick={() => void handleSave()}>
          Save
        </Button>
        <Button
          size="sm"
          variant="subtle"
          color="gray"
          disabled={isSaving}
          onClick={handleCancel}
          style={tapTargetStyle}
        >
          Cancel
        </Button>
      </Group>
    </Group>
  );
}
