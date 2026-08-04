"use client";

import { Box, Stack, Text } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  AGENT_BLOCK_COPIED_ANNOUNCEMENT,
  AGENT_COPY_KEY_LABEL,
  AGENT_KEY_COPIED_ANNOUNCEMENT,
  AGENT_MINTED_ANNOUNCEMENT,
  AGENT_PROVIDER_IDS,
  AGENT_REVOKE_CONFIRM_LABEL,
  AGENT_REVOKE_FAILED_LINE,
  AGENT_REVOKE_LABEL,
  type AgentConnection,
  type AgentProviderId,
} from "@growthmind/shared";

import { resolveAgentPanelState, type AgentPanelAction } from "./agent-panel-state";
import { AgentPanelBody } from "./AgentPanelBody";
import { mintAgentKey, revokeAgentKeys } from "./api";
import styles from "./first-run.module.css";
import {
  EMPTY_HOLD,
  useHeldAgentPanel,
  useLiveAgentConnection,
  type AgentPanelHold,
} from "./live-agent";

interface AgentPanelProps {
  readonly connection: AgentConnection;
  readonly mcpUrl: string;
  readonly providerOrder: readonly AgentProviderId[];
}

type Match = (node: HTMLButtonElement) => boolean;

// The body is render-pure and takes no refs, so the two controls focus lands on
// are found in the mounted subtree rather than handed down.
function control(root: HTMLElement | null, match: Match): HTMLButtonElement | null {
  if (root === null) {
    return null;
  }

  return [...root.querySelectorAll<HTMLButtonElement>("button")].find(match) ?? null;
}

const named =
  (label: string): Match =>
  (node) =>
    node.getAttribute("aria-label") === label;

const reading =
  (label: string): Match =>
  (node) =>
    (node.textContent ?? "").trim() === label;

export function AgentPanel(props: AgentPanelProps) {
  // Never the prop alone: first contact arrives from outside the browser, and the
  // poll that notices it re-renders this through the context, not the subtree.
  const connection = useLiveAgentConnection(props.connection);
  const router = useRouter();

  // Page memory, and nowhere else: nothing writes this to storage and nothing
  // re-fetches it. A reload loses it, and the panel then renders `waiting`. The
  // screen above holds it so arming — which swaps this component for a second
  // instance of itself — cannot destroy a key that is shown once.
  const held = useHeldAgentPanel();
  const [ownHold, setOwnHold] = useState<AgentPanelHold>(EMPTY_HOLD);

  const [action, setAction] = useState<AgentPanelAction>("idle");
  const [revokeFailed, setRevokeFailed] = useState(false);
  const [fileFormOpen, setFileFormOpen] = useState(false);
  const [announcement, setAnnouncement] = useState<string | null>(null);

  const hold = held?.hold ?? ownHold;
  const setHold = held?.setHold ?? setOwnHold;

  const rawKey = hold.rawKey;
  const provider: AgentProviderId =
    hold.provider ?? props.providerOrder[0] ?? AGENT_PROVIDER_IDS[0];

  const panel = useRef<HTMLDivElement>(null);
  const confirming = useRef(false);
  const busy = useRef(false);
  const focusedKey = useRef(rawKey);

  const state = resolveAgentPanelState({ connection, rawKey, action });

  useEffect(() => {
    // A key already held when this instance mounted is one the founder minted
    // before arming: moving focus for it would steal the press that armed.
    if (rawKey === null || focusedKey.current === rawKey) {
      return;
    }
    focusedKey.current = rawKey;

    // Mantine's `loading` sets `disabled`, which drops the pressed control out of
    // the tab order and strands focus on the body. The next action is copying the
    // key, so focus goes there (UX §5.5).
    control(panel.current, named(AGENT_COPY_KEY_LABEL))?.focus();
  }, [rawKey]);

  // UX §5.5 rows 20/21: Escape is the second way out of the confirm, and the
  // effect below moves focus back to the control it replaced. No test drives the
  // key press — this repo has no DOM renderer.
  useEffect(() => {
    if (action !== "confirming-revoke") {
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setAction("idle");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [action]);

  useEffect(() => {
    const open = action === "confirming-revoke";
    const closed = confirming.current && !open;
    confirming.current = open;

    if (open) {
      control(panel.current, reading(AGENT_REVOKE_CONFIRM_LABEL))?.focus();
      return;
    }

    // Back to the control the confirm replaced, when it is on screen again.
    if (closed) {
      control(panel.current, reading(AGENT_REVOKE_LABEL))?.focus();
    }
  }, [action]);

  async function mint(): Promise<void> {
    if (busy.current) {
      return;
    }
    busy.current = true;

    setRevokeFailed(false);
    setAnnouncement(null);
    setAction("minting");

    const key = await mintAgentKey(provider);
    busy.current = false;

    if (key === null) {
      setAction("failed");
      return;
    }

    setHold({ rawKey: key, provider });
    setAction("idle");
    setAnnouncement(AGENT_MINTED_ANNOUNCEMENT);

    // The step's new state is persisted, so it is re-read rather than guessed at
    // here — the sequence's own row is derived from a payload minted after it.
    router.refresh();
  }

  async function confirmRevoke(): Promise<void> {
    if (busy.current) {
      return;
    }
    busy.current = true;

    const revoked = await revokeAgentKeys();
    busy.current = false;

    setRevokeFailed(!revoked);

    if (!revoked) {
      setAction("idle");
      return;
    }

    setHold({ ...hold, rawKey: null });
    setAction("revoked");
    setAnnouncement(null);
    router.refresh();
  }

  function openConfirm(): void {
    setRevokeFailed(false);
    setAction("confirming-revoke");
  }

  // Closed again on every switch: the disclosure belongs to the block it opened,
  // and the next assistant may not have one at all (UX §5.3).
  function pickProvider(id: AgentProviderId): void {
    setFileFormOpen(false);
    setHold({ ...hold, provider: id });
  }

  // A render nobody pressed for is at rest: a reload, a poll and a teammate's
  // first visit all mount settled, and only a press animates (T5).
  const moved = action !== "idle" || rawKey !== null;

  return (
    <Stack gap="sm" ref={panel}>
      <Box key={moved ? state : "at-rest"} className={moved ? styles.agentEnter : undefined}>
        <AgentPanelBody
          state={state}
          provider={provider}
          mcpUrl={props.mcpUrl}
          rawKey={rawKey}
          providerOrder={props.providerOrder}
          onPickProvider={pickProvider}
          onMint={() => void mint()}
          onRevoke={openConfirm}
          onConfirmRevoke={() => void confirmRevoke()}
          onCancelRevoke={() => setAction("idle")}
          fileFormOpen={fileFormOpen}
          onToggleFileForm={() => setFileFormOpen((open) => !open)}
          announcement={announcement}
          onCopyKey={() => setAnnouncement(AGENT_KEY_COPIED_ANNOUNCEMENT)}
          onCopyBlock={() => setAnnouncement(AGENT_BLOCK_COPIED_ANNOUNCEMENT)}
        />
      </Box>

      {/* The body has no state for a refused revoke: the key is still live, so
          `error` would say the opposite of what happened. */}
      {revokeFailed ? (
        <Text size="sm" c="stamp.4">
          {AGENT_REVOKE_FAILED_LINE}
        </Text>
      ) : null}
    </Stack>
  );
}
