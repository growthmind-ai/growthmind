"use client";

import { ActionIcon, Button, Group, TextInput, Title } from "@mantine/core";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { tapTargetStyle } from "@/components/ui/tap-target";
import { renameWorkspace } from "@/lib/actions/workspace";

type Mode = "display" | "editing" | "saving" | "error";

const EMPTY_NAME_MESSAGE = "Give your workspace a name — anything works.";

interface WorkspaceNameProps {
  initialName: string;
}

export function WorkspaceName({ initialName }: WorkspaceNameProps) {
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [mode, setMode] = useState<Mode>("display");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [editSession, setEditSession] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);

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
