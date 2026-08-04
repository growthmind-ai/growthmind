import { z } from "zod";

export const AGENT_PROVIDER_IDS = [
  "claude-code",
  "cursor",
  "copilot",
  "codex",
  "windsurf",
] as const;

export type AgentProviderId = (typeof AGENT_PROVIDER_IDS)[number];

export const agentProviderIdSchema = z.enum(AGENT_PROVIDER_IDS);

export const AGENT_SERVER_NAME = "growthmind";
export const AGENT_BEARER_HEADER = "Authorization";
export const AGENT_KEY_PLACEHOLDER = "YOUR_KEY_HERE";
export const AGENT_KEY_ENV_VAR = "GROWTHMIND_API_KEY";
export const AGENT_COPILOT_INPUT_ID = "growthmind-key";
export const AGENT_COPILOT_INPUT_DESCRIPTION = "Growthmind API key";
export const AGENT_COPILOT_USER_SCOPE_COMMAND = "MCP: Open User Configuration";

export const AGENT_CONFIG_PATHS = {
  "claude-code": ".mcp.json",
  cursor: "~/.cursor/mcp.json",
  copilot: ".vscode/mcp.json",
  codex: "~/.codex/config.toml",
  windsurf: "~/.codeium/windsurf/mcp_config.json",
} as const satisfies Record<AgentProviderId, string>;

export type KeyDelivery = "in-block" | "prompted" | "env-var";

export type AgentBlockFormat = "json" | "toml" | "command";

export interface AgentBlockInput {
  readonly url: string;
  readonly key: string;
}

export interface AgentProviderConfig {
  readonly id: AgentProviderId;
  readonly path: string;
  readonly format: AgentBlockFormat;
  readonly keyDelivery: KeyDelivery;
  readonly render: (input: AgentBlockInput) => string;
  readonly disclosure: ((input: AgentBlockInput) => string) | null;
}

function quoted(value: string): string {
  return JSON.stringify(value);
}

function bearer(secret: string): string {
  return quoted(`Bearer ${secret}`);
}

const SERVER = quoted(AGENT_SERVER_NAME);
const HEADER = quoted(AGENT_BEARER_HEADER);

const COPILOT_KEY_REFERENCE = `\${input:${AGENT_COPILOT_INPUT_ID}}`;

const ENV_VAR_KEY_REFERENCE = `\${${AGENT_KEY_ENV_VAR}}`;

function claudeCodeCommand(input: AgentBlockInput): string {
  return `claude mcp add --transport http ${AGENT_SERVER_NAME} ${input.url} \\
  --header ${quoted(`${AGENT_BEARER_HEADER}: Bearer ${input.key}`)}`;
}

// This file sits in the project root and is committed with the code, so the
// header names a variable the file expands at read time rather than carrying
// the key itself — the same reason the Copilot block prompts instead.
function claudeCodeFile(input: AgentBlockInput): string {
  return `{
  "mcpServers": {
    ${SERVER}: {
      "type": "http",
      "url": ${quoted(input.url)},
      "headers": { ${HEADER}: ${bearer(ENV_VAR_KEY_REFERENCE)} }
    }
  }
}`;
}

function cursorFile(input: AgentBlockInput): string {
  return `{
  "mcpServers": {
    ${SERVER}: {
      "url": ${quoted(input.url)},
      "headers": { ${HEADER}: ${bearer(input.key)} }
    }
  }
}`;
}

function copilotFile(input: AgentBlockInput): string {
  return `{
  "inputs": [
    {
      "type": "promptString",
      "id": ${quoted(AGENT_COPILOT_INPUT_ID)},
      "description": ${quoted(AGENT_COPILOT_INPUT_DESCRIPTION)},
      "password": true
    }
  ],
  "servers": {
    ${SERVER}: {
      "type": "http",
      "url": ${quoted(input.url)},
      "headers": { ${HEADER}: ${bearer(COPILOT_KEY_REFERENCE)} }
    }
  }
}`;
}

function codexFile(input: AgentBlockInput): string {
  return `[mcp_servers.${AGENT_SERVER_NAME}]
url = ${quoted(input.url)}
bearer_token_env_var = ${quoted(AGENT_KEY_ENV_VAR)}`;
}

function windsurfFile(input: AgentBlockInput): string {
  return `{
  "mcpServers": {
    ${SERVER}: {
      "serverUrl": ${quoted(input.url)},
      "headers": { ${HEADER}: ${bearer(input.key)} }
    }
  }
}`;
}

export const AGENT_PROVIDER_CONFIGS: readonly AgentProviderConfig[] = Object.freeze([
  {
    id: "claude-code",
    path: AGENT_CONFIG_PATHS["claude-code"],
    format: "command",
    keyDelivery: "in-block",
    render: claudeCodeCommand,
    disclosure: claudeCodeFile,
  },
  {
    id: "cursor",
    path: AGENT_CONFIG_PATHS.cursor,
    format: "json",
    keyDelivery: "in-block",
    render: cursorFile,
    disclosure: null,
  },
  {
    id: "copilot",
    path: AGENT_CONFIG_PATHS.copilot,
    format: "json",
    keyDelivery: "prompted",
    render: copilotFile,
    disclosure: null,
  },
  {
    id: "codex",
    path: AGENT_CONFIG_PATHS.codex,
    format: "toml",
    keyDelivery: "env-var",
    render: codexFile,
    disclosure: null,
  },
  {
    id: "windsurf",
    path: AGENT_CONFIG_PATHS.windsurf,
    format: "json",
    keyDelivery: "in-block",
    render: windsurfFile,
    disclosure: null,
  },
]);

const CONFIG_BY_ID: ReadonlyMap<string, AgentProviderConfig> = new Map(
  AGENT_PROVIDER_CONFIGS.map((config) => [config.id, config]),
);

export function agentProviderConfig(id: AgentProviderId): AgentProviderConfig {
  const config = CONFIG_BY_ID.get(id);

  if (config === undefined) {
    throw new Error(`no agent provider config for ${id}`);
  }

  return config;
}
