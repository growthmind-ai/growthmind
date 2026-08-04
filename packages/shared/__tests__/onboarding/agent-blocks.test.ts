import { describe, expect, test } from "bun:test";

import {
  loadValueUnderConstruction,
  readSourceUnderConstruction,
} from "./module-under-construction";

const OWNER = "ADD O-026 Wave 1, the onboarding/agent-blocks.ts task (D-10)";
const MODULE = "../../src/onboarding/agent-blocks";
const SOURCE_PATH = "packages/shared/src/onboarding/agent-blocks.ts";

const MCP_URL = "https://app.example.com/api/mcp";
const RAW_KEY = "gmak_wave0-agent-blocks-fixture-key-000000000000";
const PLACEHOLDER = "YOUR_KEY_HERE";
const SERVER_NAME = "growthmind";

type AgentBlockInput = {
  readonly url: string;
  readonly key: string;
};

type AgentProviderConfig = {
  readonly id: string;
  readonly path: string;
  readonly format: "json" | "toml" | "command";
  readonly keyDelivery: "in-block" | "prompted" | "env-var";
  readonly render: (input: AgentBlockInput) => string;
  readonly disclosure: ((input: AgentBlockInput) => string) | null;
};

const loadConfigs = (): Promise<readonly AgentProviderConfig[]> =>
  loadValueUnderConstruction<readonly AgentProviderConfig[]>({
    modulePath: MODULE,
    exportName: "AGENT_PROVIDER_CONFIGS",
    ownedBy: OWNER,
  });

const loadPlaceholder = (): Promise<string> =>
  loadValueUnderConstruction<string>({
    modulePath: MODULE,
    exportName: "AGENT_KEY_PLACEHOLDER",
    ownedBy: OWNER,
  });

async function configFor(id: string): Promise<AgentProviderConfig> {
  const configs = await loadConfigs();
  const config = configs.find((entry) => entry.id === id);

  if (config === undefined) {
    throw new Error(
      `NOT IMPLEMENTED YET: AGENT_PROVIDER_CONFIGS carries no entry for "${id}". ` +
        `${OWNER} owns it. The assertions below are the contract that entry must satisfy.`,
    );
  }

  return config;
}

function filled(config: AgentProviderConfig): string {
  return config.render({ url: MCP_URL, key: RAW_KEY });
}

function topLevelKeys(block: string): readonly string[] {
  return Object.keys(JSON.parse(block) as Record<string, unknown>).toSorted();
}

function serverEntry(block: string, topLevelKey: string): Record<string, unknown> {
  const root = JSON.parse(block) as Record<string, unknown>;
  const servers = root[topLevelKey];

  expect(typeof servers).toBe("object");
  expect(servers).not.toBeNull();

  const entry = (servers as Record<string, unknown>)[SERVER_NAME];

  expect(typeof entry).toBe("object");
  expect(entry).not.toBeNull();

  return entry as Record<string, unknown>;
}

function authorizationHeader(entry: Record<string, unknown>): unknown {
  const headers = entry["headers"];

  expect(typeof headers).toBe("object");
  expect(headers).not.toBeNull();

  return (headers as Record<string, unknown>)["Authorization"];
}

describe("the D9 gate — every block carries the key names its vendor documents", () => {
  test("should render Claude Code's file entry with mcpServers, url and type http", async () => {
    const claudeCode = await configFor("claude-code");

    // The CLI one-liner is the primary block; the `.mcp.json` form is the disclosure.
    expect(claudeCode.disclosure).not.toBeNull();

    const disclose = claudeCode.disclosure;
    if (disclose === null) return;

    const block = disclose({ url: MCP_URL, key: RAW_KEY });
    const entry = serverEntry(block, "mcpServers");

    expect(topLevelKeys(block)).toContain("mcpServers");
    expect(topLevelKeys(block)).not.toContain("servers");

    expect(entry["type"]).toBe("http");
    expect(entry["url"]).toBe(MCP_URL);
    expect(Object.keys(entry)).not.toContain("serverUrl");
    expect(authorizationHeader(entry)).toBe(`Bearer ${RAW_KEY}`);

    expect(filled(claudeCode)).toContain(`Authorization: Bearer ${RAW_KEY}`);
  });

  test("should render Cursor with mcpServers and url and no type field at all", async () => {
    const cursor = await configFor("cursor");
    const block = filled(cursor);
    const entry = serverEntry(block, "mcpServers");

    expect(topLevelKeys(block)).toContain("mcpServers");
    expect(topLevelKeys(block)).not.toContain("servers");

    expect(Object.keys(entry)).not.toContain("type");
    expect(entry["url"]).toBe(MCP_URL);
    expect(Object.keys(entry)).not.toContain("serverUrl");
    expect(authorizationHeader(entry)).toBe(`Bearer ${RAW_KEY}`);
  });

  test("should render Copilot with servers, never mcpServers, and type http", async () => {
    const copilot = await configFor("copilot");
    const block = filled(copilot);
    const entry = serverEntry(block, "servers");

    expect(topLevelKeys(block)).toContain("servers");
    expect(topLevelKeys(block)).not.toContain("mcpServers");

    expect(entry["type"]).toBe("http");
    expect(entry["url"]).toBe(MCP_URL);
    expect(Object.keys(entry)).not.toContain("serverUrl");
    expect(authorizationHeader(entry)).toBe("Bearer ${input:growthmind-key}");
  });

  test("should render Windsurf with serverUrl, never url, and no type field", async () => {
    const windsurf = await configFor("windsurf");
    const block = filled(windsurf);
    const entry = serverEntry(block, "mcpServers");

    expect(topLevelKeys(block)).toContain("mcpServers");
    expect(topLevelKeys(block)).not.toContain("servers");

    expect(entry["serverUrl"]).toBe(MCP_URL);
    expect(Object.keys(entry)).not.toContain("url");
    expect(Object.keys(entry)).not.toContain("type");
    expect(authorizationHeader(entry)).toBe(`Bearer ${RAW_KEY}`);
  });
});

describe("the two blocks that are not a plain JSON paste", () => {
  test("should render the Codex block as TOML with the documented bearer form", async () => {
    const codex = await configFor("codex");
    const block = filled(codex);

    expect(block).toContain("[mcp_servers.growthmind]");
    expect(block).toMatch(/^url = "https:\/\/app\.example\.com\/api\/mcp"$/m);
    expect(block).toContain('bearer_token_env_var = "GROWTHMIND_API_KEY"');

    expect(block).not.toContain("http_headers");
    expect(block).not.toContain(RAW_KEY);
    expect(() => JSON.parse(block)).toThrow();
  });

  test("should render the Copilot block with the inputs array and no literal key", async () => {
    const copilot = await configFor("copilot");
    const block = filled(copilot);

    expect(block).not.toContain(RAW_KEY);
    expect(block).toContain("${input:growthmind-key}");

    const root = JSON.parse(block) as Record<string, unknown>;
    const inputs = root["inputs"];

    expect(Array.isArray(inputs)).toBe(true);

    const declared = (inputs as readonly Record<string, unknown>[]).filter(
      (input) => input["id"] === "growthmind-key",
    );

    expect(declared).toHaveLength(1);
    expect(declared[0]?.["type"]).toBe("promptString");
    expect(declared[0]?.["password"]).toBe(true);
  });
});

describe("the descriptor table — research Part A, unaltered", () => {
  test("should show every provider's verified config path", async () => {
    const configs = await loadConfigs();

    expect(configs.map((entry) => entry.id).toSorted()).toEqual(
      ["claude-code", "codex", "copilot", "cursor", "windsurf"].toSorted(),
    );

    const byId = new Map(configs.map((entry) => [entry.id, entry.path]));

    expect(byId.get("cursor")).toBe("~/.cursor/mcp.json");
    expect(byId.get("copilot")).toBe(".vscode/mcp.json");
    expect(byId.get("codex")).toBe("~/.codex/config.toml");
    expect(byId.get("windsurf")).toBe("~/.codeium/windsurf/mcp_config.json");

    // Part A's Claude Code cell is the CLI plus a project file; the file is the one path in it.
    expect(byId.get("claude-code")).toContain(".mcp.json");
  });

  test("should declare the format and key delivery each vendor's design forces", async () => {
    const configs = await loadConfigs();
    const byId = new Map(configs.map((entry) => [entry.id, entry]));

    expect(byId.get("claude-code")?.format).toBe("command");
    expect(byId.get("cursor")?.format).toBe("json");
    expect(byId.get("copilot")?.format).toBe("json");
    expect(byId.get("codex")?.format).toBe("toml");
    expect(byId.get("windsurf")?.format).toBe("json");

    expect(byId.get("claude-code")?.keyDelivery).toBe("in-block");
    expect(byId.get("cursor")?.keyDelivery).toBe("in-block");
    expect(byId.get("copilot")?.keyDelivery).toBe("prompted");
    expect(byId.get("codex")?.keyDelivery).toBe("env-var");
    expect(byId.get("windsurf")?.keyDelivery).toBe("in-block");
  });

  test("should hang a disclosure on Claude Code and on nothing else", async () => {
    const configs = await loadConfigs();

    const withDisclosure = configs
      .filter((entry) => entry.disclosure !== null)
      .map((entry) => entry.id);

    expect(withDisclosure).toEqual(["claude-code"]);
  });
});

describe("what every one of the five blocks must and must not carry", () => {
  test("should ask no block to configure a protocol version", async () => {
    const configs = await loadConfigs();
    const banned = ["protocolVersion", "2025-11-25", "2026-07-28"];

    const offenders: string[] = [];

    for (const config of configs) {
      const blocks = [filled(config)];
      if (config.disclosure !== null) {
        blocks.push(config.disclosure({ url: MCP_URL, key: RAW_KEY }));
      }

      for (const block of blocks) {
        for (const needle of banned) {
          if (block.includes(needle)) offenders.push(`${config.id} carries ${needle}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("should fill one template two ways without changing its structure", async () => {
    const configs = await loadConfigs();
    const placeholder = await loadPlaceholder();

    expect(placeholder).toBe(PLACEHOLDER);

    const drifted: string[] = [];

    for (const config of configs) {
      const renders: readonly ((input: AgentBlockInput) => string)[] =
        config.disclosure === null ? [config.render] : [config.render, config.disclosure];

      for (const render of renders) {
        const withKey = render({ url: MCP_URL, key: RAW_KEY });
        const withPlaceholder = render({ url: MCP_URL, key: placeholder });

        if (withKey.replaceAll(RAW_KEY, placeholder) !== withPlaceholder) {
          drifted.push(config.id);
        }
      }
    }

    expect(drifted).toEqual([]);
  });

  test("should carry the supplied url into every block", async () => {
    const configs = await loadConfigs();

    const missing: string[] = [];

    for (const config of configs) {
      if (!filled(config).includes(MCP_URL)) missing.push(config.id);

      const disclose = config.disclosure;
      if (disclose !== null && !disclose({ url: MCP_URL, key: RAW_KEY }).includes(MCP_URL)) {
        missing.push(`${config.id} disclosure`);
      }
    }

    expect(missing).toEqual([]);
  });

  test("should hold no literal address of its own, so a deployment can never read localhost", async () => {
    const text = readSourceUnderConstruction({ repoRelativePath: SOURCE_PATH, ownedBy: OWNER });

    expect(text).not.toContain("localhost");
    expect(text).not.toContain("http://");
  });
});
