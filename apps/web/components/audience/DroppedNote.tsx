"use client";

import { Anchor, Text } from "@mantine/core";
import { useEffect, useRef } from "react";

import { tapTargetStyle } from "@/components/ui/tap-target";

export const DROPPED_NOTE = "Dropped — you said this is wrong.";

export interface DroppedNoteProps {
  readonly pending: boolean;
  readonly failed: string | null;
  readonly onUndo: () => void;
  readonly onDismiss: () => void;
  readonly className?: string;
}

// Dropping unmounts the surface the button was pressed on, so focus would land on <body>
// with nothing said. The one control that reverses the drop takes it instead, and the note
// itself is a status region rather than decoration.
export function DroppedNote({ pending, failed, onUndo, onDismiss, className }: DroppedNoteProps) {
  const undoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    undoRef.current?.focus();
  }, []);

  return (
    <>
      {/* `output` rather than a div carrying role="status": the note and its two verbs are
          the only announcement a drop makes, and the surface they replaced is already gone. */}
      <div className={className}>
        <output>
          <Text size="sm" c="dimmed" span>
            {DROPPED_NOTE}{" "}
          </Text>
          <Anchor
            ref={undoRef}
            component="button"
            type="button"
            size="sm"
            style={tapTargetStyle}
            disabled={pending}
            onClick={onUndo}
          >
            Undo
          </Anchor>
          <Text size="sm" c="dimmed" span>
            {" · "}
          </Text>
          <Anchor
            component="button"
            type="button"
            size="sm"
            c="dimmed"
            style={tapTargetStyle}
            disabled={pending}
            onClick={onDismiss}
          >
            Dismiss
          </Anchor>
        </output>
      </div>
      {failed === null ? null : (
        <Text size="xs" c="red" component="output">
          {failed}
        </Text>
      )}
    </>
  );
}
