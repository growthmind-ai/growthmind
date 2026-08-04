"use client";

import { Button, Collapse, CopyButton, Group, NativeSelect, Stack, Text } from "@mantine/core";
import type { CSSProperties, ReactNode } from "react";

import {
  agentProviderConfig,
  AGENT_CLAUDE_APPROVAL_NOTE,
  AGENT_CLAUDE_ENV_VAR_NOTE,
  AGENT_CLAUDE_FILE_DISCLOSURE,
  AGENT_CLAUDE_TYPE_TRAP,
  AGENT_CODEX_ENV_VAR_NOTE,
  AGENT_CONNECTED_LINE,
  AGENT_CONNECTED_ORG_LINE,
  AGENT_COPILOT_PROMPTED_NOTE,
  AGENT_COPILOT_USER_SCOPE_COMMAND,
  AGENT_COPILOT_USER_SCOPE_TEMPLATE,
  AGENT_COPY_BLOCK_TEMPLATE,
  AGENT_COPY_KEY_LABEL,
  AGENT_EMPTY_IS_FINE_LINE,
  AGENT_KEY_GONE_NOTICE,
  AGENT_KEY_HOLE_NOTICE,
  AGENT_KEY_LABEL,
  AGENT_KEY_ONCE_NOTICE,
  AGENT_KEY_PLACEHOLDER,
  AGENT_MINT_AGAIN_LABEL,
  AGENT_MINT_FAILED_LINE,
  AGENT_MINT_PENDING,
  AGENT_MINT_TEMPLATE,
  AGENT_PASTE_INTO_TEMPLATE,
  AGENT_PICK_PROMPT,
  AGENT_PRE_MINT_LINE,
  AGENT_REVOKE_CANCEL_LABEL,
  AGENT_REVOKE_CONFIRM_LABEL,
  AGENT_REVOKE_CONSEQUENCE,
  AGENT_REVOKE_LABEL,
  AGENT_REVOKED_LINE,
  AGENT_RUN_ANYWHERE_LINE,
  AGENT_WAITING_LINE,
  AGENT_WAITING_NEXT,
  COPIED_LABEL,
  COPY_LABEL,
  providerDisplayName,
  type AgentBlockInput,
  type AgentProviderConfig,
  type AgentProviderId,
} from "@growthmind/shared";

import { CopyableBlock } from "@/components/ui/CopyableBlock";
import { CopyableCommand } from "@/components/ui/CopyableCommand";
import { tapTargetStyle } from "@/components/ui/tap-target";

import type { AgentPanelState } from "./agent-panel-state";

interface AgentPanelBodyProps {
  readonly state: AgentPanelState;
  readonly provider: AgentProviderId;
  readonly mcpUrl: string;
  readonly rawKey: string | null;
  readonly providerOrder: readonly AgentProviderId[];
  readonly onPickProvider: (id: AgentProviderId) => void;
  readonly onMint: () => void;
  readonly onRevoke: () => void;
  readonly onConfirmRevoke: () => void;
  readonly onCancelRevoke: () => void;
  readonly fileFormOpen: boolean;
  readonly onToggleFileForm: () => void;
}

// One polite region, always mounted, carrying whichever sentence the state
// leads with — so it exists before anything fills it, and a flip announces
// itself once rather than twice (UX §5.5).
const STATUS_LINES: Readonly<Record<AgentPanelState, string | null>> = {
  choose: null,
  minting: null,
  reveal: AGENT_KEY_ONCE_NOTICE,
  waiting: AGENT_WAITING_LINE,
  connected: AGENT_CONNECTED_LINE,
  error: AGENT_MINT_FAILED_LINE,
  revoked: AGENT_REVOKED_LINE,
  "revoke-confirm": null,
};

const KEY_BOX_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflowX: "auto",
  whiteSpace: "nowrap",
  display: "flex",
  alignItems: "center",
  border: "1px solid var(--mantine-color-default-border)",
  borderRadius: "var(--mantine-radius-sm)",
  background: "var(--mantine-color-default)",
};

function withName(template: string, name: string): string {
  return template.split("{assistant}").join(name);
}

function withAssistant(template: string, provider: AgentProviderId): string {
  return withName(template, providerDisplayName(provider));
}

function withPath(template: string, path: string): string {
  return template.split("{path}").join(path);
}

function withCommand(template: string, command: string): string {
  return template.split("{command}").join(command);
}

function AssistantPicker(props: {
  readonly provider: AgentProviderId;
  readonly providerOrder: readonly AgentProviderId[];
  readonly onPick: (id: AgentProviderId) => void;
}) {
  return (
    <NativeSelect
      label={AGENT_PICK_PROMPT}
      value={props.provider}
      onChange={(event) => props.onPick(event.currentTarget.value as AgentProviderId)}
      data={props.providerOrder.map((id) => ({ value: id, label: providerDisplayName(id) }))}
      styles={{ input: tapTargetStyle }}
    />
  );
}

function PathLine(props: { readonly config: AgentProviderConfig }) {
  if (props.config.format === "command") {
    return (
      <Text size="sm" c="dimmed">
        {AGENT_RUN_ANYWHERE_LINE}
      </Text>
    );
  }

  return (
    <Text size="sm" c="dimmed">
      {withPath(AGENT_PASTE_INTO_TEMPLATE, props.config.path)}
    </Text>
  );
}

function DeliveryNote(props: { readonly config: AgentProviderConfig }): ReactNode {
  if (props.config.keyDelivery === "prompted") {
    return (
      <Stack gap="xs">
        <Text size="sm" c="dimmed">
          {AGENT_COPILOT_PROMPTED_NOTE}
        </Text>
        <Text size="sm" c="dimmed">
          {withCommand(AGENT_COPILOT_USER_SCOPE_TEMPLATE, AGENT_COPILOT_USER_SCOPE_COMMAND)}
        </Text>
      </Stack>
    );
  }

  if (props.config.keyDelivery === "env-var") {
    return (
      <Text size="sm" c="dimmed">
        {AGENT_CODEX_ENV_VAR_NOTE}
      </Text>
    );
  }

  return null;
}

// The one disclosure in the panel (UX D-9, §5.3). Closed at rest keeps the
// primary path a single block, and the open flag is the island's, so this stays
// hook-free.
function FileForm(props: {
  readonly config: AgentProviderConfig;
  readonly filled: AgentBlockInput;
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  const render = props.config.disclosure;

  if (render === null) {
    return null;
  }

  return (
    <Stack gap="xs">
      <Group justify="flex-start">
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          aria-expanded={props.open}
          onClick={props.onToggle}
          style={tapTargetStyle}
        >
          {AGENT_CLAUDE_FILE_DISCLOSURE}
        </Button>
      </Group>

      <Collapse expanded={props.open}>
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            {AGENT_CLAUDE_TYPE_TRAP}
          </Text>
          <Text size="sm" c="dimmed">
            {AGENT_CLAUDE_ENV_VAR_NOTE}
          </Text>
          <Text size="sm" c="dimmed">
            {AGENT_CLAUDE_APPROVAL_NOTE}
          </Text>
          <Text size="sm" c="dimmed">
            {withPath(AGENT_PASTE_INTO_TEMPLATE, props.config.path)}
          </Text>
          <CopyableBlock
            block={render(props.filled)}
            copyLabel={withName(AGENT_COPY_BLOCK_TEMPLATE, props.config.path)}
          />
        </Stack>
      </Collapse>
    </Stack>
  );
}

function BlockSection(props: {
  readonly provider: AgentProviderId;
  readonly mcpUrl: string;
  readonly rawKey: string | null;
  readonly fileFormOpen: boolean;
  readonly onToggleFileForm: () => void;
}) {
  const config = agentProviderConfig(props.provider);
  const filled = { url: props.mcpUrl, key: props.rawKey ?? AGENT_KEY_PLACEHOLDER };
  const label = withAssistant(AGENT_COPY_BLOCK_TEMPLATE, props.provider);

  return (
    <Stack gap="xs">
      <PathLine config={config} />

      {config.format === "command" ? (
        <CopyableCommand command={config.render(filled)} copyLabel={label} />
      ) : (
        <CopyableBlock block={config.render(filled)} copyLabel={label} />
      )}

      <DeliveryNote config={config} />

      <FileForm
        config={config}
        filled={filled}
        open={props.fileFormOpen}
        onToggle={props.onToggleFileForm}
      />
    </Stack>
  );
}

function KeyRow(props: { readonly rawKey: string }) {
  return (
    <Stack gap={4}>
      <Text size="xs" fw={700} tt="uppercase" c="dimmed">
        {AGENT_KEY_LABEL}
      </Text>

      <Group gap="xs" wrap="nowrap" align="stretch">
        <Text component="span" ff="monospace" fz="sm" px="sm" py={8} style={KEY_BOX_STYLE}>
          {props.rawKey}
        </Text>

        <CopyButton value={props.rawKey}>
          {({ copied, copy }) => (
            <Button
              variant="default"
              size="compact-sm"
              onClick={copy}
              aria-label={AGENT_COPY_KEY_LABEL}
              style={tapTargetStyle}
            >
              {copied ? COPIED_LABEL : COPY_LABEL}
            </Button>
          )}
        </CopyButton>
      </Group>
    </Stack>
  );
}

function RevokeControl(props: { readonly onRevoke: () => void }) {
  return (
    <Group justify="flex-start">
      <Button variant="subtle" size="compact-sm" onClick={props.onRevoke} style={tapTargetStyle}>
        {AGENT_REVOKE_LABEL}
      </Button>
    </Group>
  );
}

function ChooseBody(props: {
  readonly provider: AgentProviderId;
  readonly pending: boolean;
  readonly onMint: () => void;
}) {
  return (
    <Stack gap="sm">
      <Text size="sm">{AGENT_PRE_MINT_LINE}</Text>

      <PathLine config={agentProviderConfig(props.provider)} />

      <Group justify="flex-start">
        <Button
          onClick={props.onMint}
          disabled={props.pending}
          loading={props.pending}
          style={tapTargetStyle}
          w={{ base: "100%", xs: "auto" }}
        >
          {props.pending ? AGENT_MINT_PENDING : withAssistant(AGENT_MINT_TEMPLATE, props.provider)}
        </Button>
      </Group>
    </Stack>
  );
}

function RevealBody(props: {
  readonly provider: AgentProviderId;
  readonly mcpUrl: string;
  readonly rawKey: string | null;
  readonly fileFormOpen: boolean;
  readonly onToggleFileForm: () => void;
}) {
  return (
    <Stack gap="sm">
      {props.rawKey === null ? null : <KeyRow rawKey={props.rawKey} />}

      <BlockSection
        provider={props.provider}
        mcpUrl={props.mcpUrl}
        rawKey={props.rawKey}
        fileFormOpen={props.fileFormOpen}
        onToggleFileForm={props.onToggleFileForm}
      />

      <Text size="sm" c="dimmed">
        {AGENT_WAITING_NEXT}
      </Text>
    </Stack>
  );
}

function WaitingBody(props: {
  readonly provider: AgentProviderId;
  readonly mcpUrl: string;
  readonly onMint: () => void;
  readonly onRevoke: () => void;
  readonly fileFormOpen: boolean;
  readonly onToggleFileForm: () => void;
}) {
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {AGENT_KEY_GONE_NOTICE}
      </Text>
      <Text size="sm" c="dimmed">
        {AGENT_KEY_HOLE_NOTICE}
      </Text>

      <BlockSection
        provider={props.provider}
        mcpUrl={props.mcpUrl}
        rawKey={null}
        fileFormOpen={props.fileFormOpen}
        onToggleFileForm={props.onToggleFileForm}
      />

      <Group justify="flex-start">
        <Button variant="default" size="compact-sm" onClick={props.onMint} style={tapTargetStyle}>
          {AGENT_MINT_AGAIN_LABEL}
        </Button>
      </Group>

      <Text size="sm" c="dimmed">
        {AGENT_WAITING_NEXT}
      </Text>

      <RevokeControl onRevoke={props.onRevoke} />
    </Stack>
  );
}

function ConnectedBody(props: { readonly onRevoke: () => void }) {
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {AGENT_CONNECTED_ORG_LINE}
      </Text>
      <Text size="sm" c="dimmed">
        {AGENT_EMPTY_IS_FINE_LINE}
      </Text>

      <RevokeControl onRevoke={props.onRevoke} />
    </Stack>
  );
}

function ConfirmBody(props: { readonly onConfirm: () => void; readonly onCancel: () => void }) {
  return (
    <Stack gap="sm">
      <Text size="sm">{AGENT_REVOKE_CONSEQUENCE}</Text>

      <Group gap="xs" justify="flex-start">
        <Button color="red" onClick={props.onConfirm} style={tapTargetStyle}>
          {AGENT_REVOKE_CONFIRM_LABEL}
        </Button>
        <Button variant="default" onClick={props.onCancel} style={tapTargetStyle}>
          {AGENT_REVOKE_CANCEL_LABEL}
        </Button>
      </Group>
    </Stack>
  );
}

function stateBody(props: AgentPanelBodyProps): ReactNode {
  switch (props.state) {
    case "reveal":
      return (
        <RevealBody
          provider={props.provider}
          mcpUrl={props.mcpUrl}
          rawKey={props.rawKey}
          fileFormOpen={props.fileFormOpen}
          onToggleFileForm={props.onToggleFileForm}
        />
      );

    case "waiting":
      return (
        <WaitingBody
          provider={props.provider}
          mcpUrl={props.mcpUrl}
          onMint={props.onMint}
          onRevoke={props.onRevoke}
          fileFormOpen={props.fileFormOpen}
          onToggleFileForm={props.onToggleFileForm}
        />
      );

    case "connected":
      return <ConnectedBody onRevoke={props.onRevoke} />;

    case "revoke-confirm":
      return <ConfirmBody onConfirm={props.onConfirmRevoke} onCancel={props.onCancelRevoke} />;

    default:
      return (
        <ChooseBody
          provider={props.provider}
          pending={props.state === "minting"}
          onMint={props.onMint}
        />
      );
  }
}

// Render-pure and hook-free by contract (ADD O-026 D-12): every one of the
// eight states renders from props alone, because this repo has no DOM renderer
// and a hook here would make four of them untestable.
export function AgentPanelBody(props: AgentPanelBodyProps) {
  return (
    <Stack gap="md">
      <AssistantPicker
        provider={props.provider}
        providerOrder={props.providerOrder}
        onPick={props.onPickProvider}
      />

      <Text size="sm" aria-live="polite">
        {STATUS_LINES[props.state]}
      </Text>

      {stateBody(props)}
    </Stack>
  );
}
