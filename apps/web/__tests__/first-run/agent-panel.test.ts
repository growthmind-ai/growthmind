// The E2E tier for O-026, and the whole of it: this repo has no DOM renderer, so
// every row below is `renderToStaticMarkup` over AgentPanelBody from props alone.
// Focus movement, the in-flight disable's effect on the tab order, and T1–T11's
// timings are NOT driven here — the focus row is a source scan and says so in its
// name, and integration-tester's replay is the behavioural gate (ADD D-12).
import { describe, expect, test } from "bun:test";
import { createElement, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import { COPY_LABEL, PROVIDER_CATALOGUE } from "@growthmind/shared";

import {
  loadValueUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import {
  AGENT_PANEL,
  AGENT_PANEL_BODY,
  blankComments,
  readExisting,
  readFirstRun,
} from "./helpers/first-run-source";
import { readMarkup } from "./helpers/rendered-markup";

const OWNER_BODY =
  "ADD O-026 D-12 (apps/web/components/first-run/AgentPanelBody.tsx — the render-pure, hook-free body)";
const OWNER_RESOLVER =
  "ADD O-026 D-12 (apps/web/components/first-run/agent-panel-state.ts — the pure state resolver)";
const OWNER_BLOCKS =
  "ADD O-026 D-10 (packages/shared/src/onboarding/agent-blocks.ts — the five config templates)";
const OWNER_MESSAGES =
  "ADD O-026 §8.2 (packages/shared/src/onboarding/messages.ts — the AGENT_ strings)";

type AgentProviderId = "claude-code" | "cursor" | "copilot" | "codex" | "windsurf";

type AgentConnectionKind = "none" | "waiting" | "connected";

type PanelAction = "idle" | "minting" | "failed" | "revoked" | "confirming-revoke";

type AgentPanelState =
  | "choose"
  | "minting"
  | "reveal"
  | "waiting"
  | "connected"
  | "error"
  | "revoked"
  | "revoke-confirm";

interface PanelInput {
  readonly connection: { readonly kind: AgentConnectionKind };
  readonly rawKey: string | null;
  readonly action: PanelAction;
}

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
  readonly announcement: string | null;
  readonly onCopyKey: () => void;
  readonly onCopyBlock: () => void;
}

interface AgentBlockInput {
  readonly url: string;
  readonly key: string;
}

interface AgentProviderConfig {
  readonly id: AgentProviderId;
  readonly path: string;
  readonly format: "json" | "toml" | "command";
  readonly keyDelivery: "in-block" | "prompted" | "env-var";
  readonly render: (input: AgentBlockInput) => string;
  readonly disclosure: ((input: AgentBlockInput) => string) | null;
}

const loadBody = (): Promise<ComponentType<AgentPanelBodyProps>> =>
  loadValueUnderConstruction<ComponentType<AgentPanelBodyProps>>({
    modulePath: underConstructionSpecifier("apps/web/components/first-run/AgentPanelBody"),
    exportName: "AgentPanelBody",
    ownedBy: OWNER_BODY,
  });

const loadResolver = (): Promise<(input: PanelInput) => AgentPanelState> =>
  loadValueUnderConstruction<(input: PanelInput) => AgentPanelState>({
    modulePath: underConstructionSpecifier("apps/web/components/first-run/agent-panel-state"),
    exportName: "resolveAgentPanelState",
    ownedBy: OWNER_RESOLVER,
  });

const message = (exportName: string): Promise<string> =>
  loadValueUnderConstruction<string>({
    modulePath: underConstructionSpecifier("packages/shared/src/onboarding/messages"),
    exportName,
    ownedBy: OWNER_MESSAGES,
  });

const blockValue = <T>(exportName: string): Promise<T> =>
  loadValueUnderConstruction<T>({
    modulePath: underConstructionSpecifier("packages/shared/src/onboarding/agent-blocks"),
    exportName,
    ownedBy: OWNER_BLOCKS,
  });

const loadConfigs = (): Promise<readonly AgentProviderConfig[]> =>
  blockValue<readonly AgentProviderConfig[]>("AGENT_PROVIDER_CONFIGS");

async function configFor(id: AgentProviderId): Promise<AgentProviderConfig> {
  const found = (await loadConfigs()).find((config) => config.id === id);

  if (found === undefined) {
    throw new Error(`NOT IMPLEMENTED YET: AGENT_PROVIDER_CONFIGS carries no entry for ${id}.`);
  }

  return found;
}

const FAKE_ROUTER: AppRouterInstance = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
};

const render = (node: ReactElement): string =>
  renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(AppRouterContext.Provider, { value: FAKE_ROUTER }, node),
    ),
  );

const MCP_URL = "https://app.example.com/api/mcp";

const RAW_KEY = "gmak_7f3c9a1b4d8e2f06";

const ORDER: readonly AgentProviderId[] = ["claude-code", "cursor", "copilot", "codex", "windsurf"];

const ASSISTANTS = PROVIDER_CATALOGUE.filter((provider) => provider.rail === "coding-assistant");

const displayNameOf = (id: AgentProviderId): string => {
  const found = ASSISTANTS.find((provider) => provider.id === id);
  if (found === undefined) throw new Error(`PROVIDER_CATALOGUE carries no assistant ${id}`);
  return found.displayName;
};

const NOOP = (): void => {};

const CHOOSE: PanelInput = { connection: { kind: "none" }, rawKey: null, action: "idle" };
const MINTING: PanelInput = { connection: { kind: "none" }, rawKey: null, action: "minting" };
const REVEAL: PanelInput = { connection: { kind: "waiting" }, rawKey: RAW_KEY, action: "idle" };
const WAITING: PanelInput = { connection: { kind: "waiting" }, rawKey: null, action: "idle" };
const CONNECTED: PanelInput = { connection: { kind: "connected" }, rawKey: null, action: "idle" };
const FAILED: PanelInput = { connection: { kind: "none" }, rawKey: null, action: "failed" };
const REVOKED: PanelInput = { connection: { kind: "none" }, rawKey: null, action: "revoked" };
const CONFIRMING: PanelInput = {
  connection: { kind: "connected" },
  rawKey: null,
  action: "confirming-revoke",
};

const FIXTURES: readonly (readonly [PanelInput, AgentPanelState])[] = [
  [CHOOSE, "choose"],
  [MINTING, "minting"],
  [REVEAL, "reveal"],
  [WAITING, "waiting"],
  [CONNECTED, "connected"],
  [FAILED, "error"],
  [REVOKED, "revoked"],
  [CONFIRMING, "revoke-confirm"],
];

// `fileFormOpen` defaults to false everywhere, so every row below that does not
// name it renders the panel exactly as a founder first meets it.
async function panelMarkup(
  input: PanelInput,
  provider: AgentProviderId = "cursor",
  fileFormOpen = false,
  announcement: string | null = null,
): Promise<string> {
  const resolve = await loadResolver();
  const Body = await loadBody();

  return render(
    createElement(Body, {
      state: resolve(input),
      provider,
      mcpUrl: MCP_URL,
      rawKey: input.rawKey,
      providerOrder: ORDER,
      onPickProvider: NOOP,
      onMint: NOOP,
      onRevoke: NOOP,
      onConfirmRevoke: NOOP,
      onCancelRevoke: NOOP,
      fileFormOpen,
      onToggleFileForm: NOOP,
      announcement,
      onCopyKey: NOOP,
      onCopyBlock: NOOP,
    }),
  );
}

const textOf = (html: string): string => readMarkup(html).text;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decode(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    const point = body.startsWith("#x")
      ? Number.parseInt(body.slice(2), 16)
      : body.startsWith("#")
        ? Number.parseInt(body.slice(1), 10)
        : Number.NaN;

    if (Number.isFinite(point)) return String.fromCodePoint(point);
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const stripTags = (html: string): string => html.replace(/<[^>]*>/g, "");

function codeBlocks(html: string): readonly string[] {
  return [...html.matchAll(/<(code|pre)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((match) =>
    decode(stripTags(match[2] ?? "")),
  );
}

interface RenderedButton {
  readonly attrs: string;
  readonly text: string;
  readonly ariaLabel: string;
  readonly disabled: boolean;
}

function buttons(html: string): readonly RenderedButton[] {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => {
    const attrs = match[1] ?? "";

    return {
      attrs,
      text: decode(stripTags(match[2] ?? ""))
        .replace(/\s+/g, " ")
        .trim(),
      ariaLabel: /\saria-label="([^"]*)"/.exec(attrs)?.[1] ?? "",
      disabled: /\sdisabled(?:\s|=|$)/.test(attrs),
    };
  });
}

const fill = (template: string, token: string, value: string): string =>
  template.split(`{${token}}`).join(value);

const before = (template: string, token: string): string =>
  (template.split(`{${token}}`)[0] ?? "").trim();

const sentenceCount = (text: string): number => [...text.matchAll(/[.!?](?:\s|$)/g)].length;

const parsedBlock = (html: string): Record<string, unknown> => {
  for (const block of codeBlocks(html)) {
    try {
      const parsed: unknown = JSON.parse(block);
      if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
    } catch {
      continue;
    }
  }

  throw new Error("no rendered code block parses as JSON");
};

const blockContaining = (html: string, needle: string): string => {
  const found = codeBlocks(html).find((block) => block.includes(needle));
  if (found === undefined) throw new Error(`no rendered code block contains \`${needle}\``);
  return found;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) throw new Error("expected an object");
  return value as Record<string, unknown>;
};

describe("the agent panel body, one row per First-Run Checklist row (O-026)", () => {
  test("the eight payload-and-action fixtures resolve to the eight states", async () => {
    const resolve = await loadResolver();

    expect(FIXTURES.map(([input]) => resolve(input))).toEqual(
      FIXTURES.map(([, expected]) => expected),
    );
  });

  test("choose offers no copy control and no block, so a wrong config cannot reach the clipboard", async () => {
    const html = await panelMarkup(CHOOSE);
    const text = textOf(html);

    const preMint = await message("AGENT_PRE_MINT_LINE");
    const pickPrompt = await message("AGENT_PICK_PROMPT");
    const mintTemplate = await message("AGENT_MINT_TEMPLATE");
    const pasteTemplate = await message("AGENT_PASTE_INTO_TEMPLATE");
    const cursor = await configFor("cursor");

    expect(text).toContain(preMint);
    expect(sentenceCount(preMint)).toBeGreaterThanOrEqual(2);
    expect(text).toContain(pickPrompt);

    expect(text).toContain(before(pasteTemplate, "path"));
    expect(text).toContain(cursor.path);
    expect(text.toLowerCase()).toContain(cursor.format);

    const primary = buttons(html).filter((button) =>
      button.text.includes(before(mintTemplate, "assistant")),
    );
    expect(primary).toHaveLength(1);
    expect(primary[0]?.text).toContain(fill(mintTemplate, "assistant", displayNameOf("cursor")));

    expect(codeBlocks(html)).toEqual([]);
    expect(html).not.toContain(MCP_URL);
    expect(buttons(html).filter((button) => button.text.includes(COPY_LABEL))).toEqual([]);
    expect(html).not.toContain(await message("AGENT_COPY_KEY_LABEL"));
  });

  test("choose puts all five assistants in the server markup, so the options exist without JS", async () => {
    const html = await panelMarkup(CHOOSE);
    const text = textOf(html);

    expect(ASSISTANTS.map((provider) => provider.id)).toEqual([...ORDER]);

    for (const id of ORDER) {
      expect({ id, offered: text.includes(displayNameOf(id)) }).toEqual({ id, offered: true });
    }

    expect([...html.matchAll(/<option\b/g)]).toHaveLength(ORDER.length);
  });

  test("every file-based provider names its own config path in choose", async () => {
    for (const config of await loadConfigs()) {
      const text = textOf(await panelMarkup(CHOOSE, config.id));

      if (config.format === "command") {
        expect({ id: config.id, format: config.format }).toEqual({
          id: config.id,
          format: "command",
        });
        continue;
      }

      expect({ id: config.id, showsPath: text.includes(config.path) }).toEqual({
        id: config.id,
        showsPath: true,
      });
    }
  });

  test("the reveal shows the one-time notice with the key, in a block that already holds it", async () => {
    const html = await panelMarkup(REVEAL);
    const text = textOf(html);

    const notice = await message("AGENT_KEY_ONCE_NOTICE");

    expect(text).toContain(notice);
    expect(html).toContain(RAW_KEY);
    expect(blockContaining(html, RAW_KEY)).toContain(MCP_URL);

    expect(text.indexOf(notice)).toBeLessThan(text.indexOf(RAW_KEY));

    expect(html).not.toContain(await message("AGENT_REVOKE_LABEL"));
  });

  test("the two copy controls share a visible label and carry distinct, non-empty aria-labels", async () => {
    const html = await panelMarkup(REVEAL);

    const copyControls = buttons(html).filter((button) => button.text.includes(COPY_LABEL));
    expect(copyControls.length).toBeGreaterThanOrEqual(2);

    const labels = copyControls.map((button) => button.ariaLabel);
    expect(labels.filter((label) => label.trim() === "")).toEqual([]);
    expect(new Set(labels).size).toBe(labels.length);

    expect(labels).toContain(await message("AGENT_COPY_KEY_LABEL"));

    const blockTemplate = await message("AGENT_COPY_BLOCK_TEMPLATE");
    expect(labels).toContain(fill(blockTemplate, "assistant", displayNameOf("cursor")));
  });

  test("Copilot's block is keyed `servers` and never carries the key itself", async () => {
    const html = await panelMarkup(REVEAL, "copilot");
    const parsed = parsedBlock(html);

    expect(Object.keys(parsed)).toContain("servers");
    expect(Object.keys(parsed)).not.toContain("mcpServers");

    const block = blockContaining(html, "servers");
    expect(block).not.toContain(RAW_KEY);
    expect(block).toContain("${input:growthmind-key}");

    expect(textOf(html)).toContain(await message("AGENT_COPILOT_PROMPTED_NOTE"));
  });

  test("Codex's block is TOML with the environment-variable bearer, not JSON", async () => {
    const html = await panelMarkup(REVEAL, "codex");
    const block = blockContaining(html, "[mcp_servers.growthmind]");

    expect(block).toContain("bearer_token_env_var");
    expect(block).not.toContain("http_headers");
    expect(() => JSON.parse(block) as unknown).toThrow();
  });

  test("Windsurf's block uses serverUrl, with no url and no type", async () => {
    const html = await panelMarkup(REVEAL, "windsurf");
    const servers = asRecord(parsedBlock(html)["mcpServers"]);
    const entry = asRecord(servers["growthmind"]);

    expect(Object.keys(entry)).toContain("serverUrl");
    expect(Object.keys(entry)).not.toContain("url");
    expect(Object.keys(entry)).not.toContain("type");
    expect(entry["serverUrl"]).toBe(MCP_URL);
  });

  test("Claude Code leads with the CLI line and names the type trap as a symptom", async () => {
    const html = await panelMarkup(REVEAL, "claude-code", true);
    const blocks = codeBlocks(html);

    expect(blocks[0] ?? "").toContain("claude mcp add");

    const fileEntry = blockContaining(html, '"type"');
    expect(fileEntry).toContain('"type": "http"');
    expect(blocks.indexOf(fileEntry)).toBeGreaterThan(0);

    const trap = await message("AGENT_CLAUDE_TYPE_TRAP");
    expect(textOf(html)).toContain(trap);

    expect(trap).toMatch(/skip/i);
    expect(trap).toMatch(/local command/i);
    expect(trap).not.toMatch(/expected string/i);
    expect(trap).not.toMatch(/\bv?\d+\.\d+\.\d+\b/);
    expect(trap).not.toMatch(/\b\d{3}\b/);
  });

  test("the committed-file form is closed at rest behind one toggle that says whether it is open", async () => {
    const atRest = await panelMarkup(REVEAL, "claude-code");
    const disclosed = await panelMarkup(REVEAL, "claude-code", true);

    const label = await message("AGENT_CLAUDE_FILE_DISCLOSURE");

    const toggleOf = (html: string): RenderedButton => {
      const found = buttons(html).filter((button) => button.text.includes(label));
      expect(found).toHaveLength(1);
      const only = found[0];
      if (only === undefined) throw new Error("unreachable — asserted above");
      return only;
    };

    expect(toggleOf(atRest).attrs).toContain('aria-expanded="false"');
    expect(toggleOf(disclosed).attrs).toContain('aria-expanded="true"');

    expect(codeBlocks(atRest)).toHaveLength(1);
    expect(codeBlocks(atRest)[0] ?? "").toContain("claude mcp add");
    expect(atRest).not.toContain("mcpServers");
    expect(codeBlocks(disclosed)).toHaveLength(2);

    const copyAtRest = buttons(atRest).filter((button) => button.text.includes(COPY_LABEL));
    const copyDisclosed = buttons(disclosed).filter((button) => button.text.includes(COPY_LABEL));
    expect(copyAtRest).toHaveLength(2);
    expect(copyDisclosed).toHaveLength(3);

    const trap = await message("AGENT_CLAUDE_TYPE_TRAP");
    expect(textOf(atRest)).not.toContain(trap);
    expect(textOf(disclosed)).toContain(trap);
  });

  test("no committed-file block hands the founder the key to commit", async () => {
    const configs = await loadConfigs();
    const committed = configs.filter((config) => !config.path.startsWith("~/"));

    expect(committed.map((config) => config.id).toSorted()).toEqual(["claude-code", "copilot"]);

    for (const config of committed) {
      const html = await panelMarkup(REVEAL, config.id, true);
      const fileBlock = blockContaining(html, '"headers"');

      expect({ id: config.id, carriesTheKey: fileBlock.includes(RAW_KEY) }).toEqual({
        id: config.id,
        carriesTheKey: false,
      });
    }
  });

  test("the file form names the variable convention rather than a second copy of it", async () => {
    const html = await panelMarkup(REVEAL, "claude-code", true);

    expect(textOf(html)).toContain(await message("AGENT_CLAUDE_ENV_VAR_NOTE"));
  });

  test("no rendered block prints localhost when the payload carries a real address", async () => {
    for (const id of ORDER) {
      for (const input of [CHOOSE, REVEAL, WAITING]) {
        const html = await panelMarkup(input, id);

        expect({ id, state: input.action, localhost: /localhost/i.test(html) }).toEqual({
          id,
          state: input.action,
          localhost: false,
        });
      }

      expect({ id, carriesTheUrl: (await panelMarkup(REVEAL, id)).includes(MCP_URL) }).toEqual({
        id,
        carriesTheUrl: true,
      });
    }
  });

  test("a reload with no client state renders waiting, its placeholder block and its next action", async () => {
    const html = await panelMarkup(WAITING);
    const text = textOf(html);

    expect(text).toContain(await message("AGENT_WAITING_LINE"));
    expect(text).toContain(await message("AGENT_KEY_GONE_NOTICE"));
    expect(text).toContain(await message("AGENT_KEY_HOLE_NOTICE"));
    expect(text).toContain(await message("AGENT_MINT_AGAIN_LABEL"));
    expect(text).toContain(await message("AGENT_WAITING_NEXT"));

    const placeholder = await blockValue<string>("AGENT_KEY_PLACEHOLDER");
    expect(blockContaining(html, placeholder)).toContain(MCP_URL);

    expect(html).not.toContain(RAW_KEY);
  });

  test("the hole notice is shown for every block that carries the key, and for neither block that does not", async () => {
    const notice = await message("AGENT_KEY_HOLE_NOTICE");
    const configs = await loadConfigs();

    expect(new Set(configs.map((config) => config.keyDelivery)).size).toBe(3);

    for (const config of configs) {
      const text = textOf(await panelMarkup(WAITING, config.id));

      expect({ id: config.id, delivery: config.keyDelivery, shown: text.includes(notice) }).toEqual(
        {
          id: config.id,
          delivery: config.keyDelivery,
          shown: config.keyDelivery === "in-block",
        },
      );
    }
  });

  test("the anywhere line stands only beside a command no directory can invalidate", async () => {
    const anywhere = await message("AGENT_RUN_ANYWHERE_LINE");
    const html = await panelMarkup(REVEAL, "claude-code");

    expect(textOf(html)).toContain(anywhere);
    expect(blockContaining(html, "claude mcp add")).toContain("--scope user");

    for (const config of await loadConfigs()) {
      const shown = textOf(await panelMarkup(REVEAL, config.id)).includes(anywhere);

      expect({ id: config.id, shown }).toEqual({
        id: config.id,
        shown: config.format === "command",
      });
    }
  });

  test("a visitor arriving after first contact renders connected, with no mint button and no key", async () => {
    const html = await panelMarkup(CONNECTED);
    const text = textOf(html);

    expect(text).toContain(await message("AGENT_CONNECTED_LINE"));
    expect(text).toContain(await message("AGENT_CONNECTED_ORG_LINE"));
    expect(text).toContain(await message("AGENT_EMPTY_IS_FINE_LINE"));

    const mintTemplate = await message("AGENT_MINT_TEMPLATE");
    expect(
      buttons(html).filter((button) => button.text.includes(before(mintTemplate, "assistant"))),
    ).toEqual([]);

    expect(codeBlocks(html)).toEqual([]);
    expect(html).not.toContain("gmak_");
  });

  test("a payload-derived state renders at rest, and the source gates the entrance on the action", async () => {
    for (const input of [CHOOSE, WAITING, CONNECTED]) {
      const html = await panelMarkup(input);

      expect({ action: input.action, animated: /animation\s*:/i.test(html) }).toEqual({
        action: input.action,
        animated: false,
      });
      expect({ action: input.action, hidden: /opacity\s*:\s*0\b/.test(html) }).toEqual({
        action: input.action,
        hidden: false,
      });
      expect({ action: input.action, entrance: /entrance|animate|pulse/i.test(html) }).toEqual({
        action: input.action,
        entrance: false,
      });
    }

    const code = blankComments(readFirstRun(AGENT_PANEL).source);
    expect(code).toMatch(/action\s*!==\s*["']idle["']/);
  });

  test("a member of another org lands on choose with nothing about the first org's key", async () => {
    const html = await panelMarkup(CHOOSE);
    const text = textOf(html);

    expect(text).toContain(await message("AGENT_PRE_MINT_LINE"));

    expect(html).not.toContain("gmak_");
    expect(html).not.toContain(await message("AGENT_KEY_LABEL"));
    expect(html).not.toContain(await message("AGENT_KEY_ONCE_NOTICE"));
  });

  test("the revoke confirm names the consequence in place, with two buttons and no modal", async () => {
    const html = await panelMarkup(CONFIRMING);
    const text = textOf(html);

    expect(text).toContain(await message("AGENT_REVOKE_CONSEQUENCE"));

    const labels = buttons(html).map((button) => button.text);
    expect(labels).toContain(await message("AGENT_REVOKE_CONFIRM_LABEL"));
    expect(labels).toContain(await message("AGENT_REVOKE_CANCEL_LABEL"));

    expect(html).not.toContain(await message("AGENT_REVOKE_LABEL"));

    expect(html).not.toMatch(/role="dialog"/);
    expect(html).not.toMatch(/aria-modal/);
    expect(html).not.toMatch(/<dialog\b/);
  });

  test("revoke is offered on waiting and connected, and on none of the other six states", async () => {
    const label = await message("AGENT_REVOKE_LABEL");

    const offered: readonly (readonly [AgentPanelState, PanelInput])[] = [
      ["waiting", WAITING],
      ["connected", CONNECTED],
    ];

    for (const [state, input] of offered) {
      expect({ state, revokeOffered: (await panelMarkup(input)).includes(label) }).toEqual({
        state,
        revokeOffered: true,
      });
    }

    const withheld: readonly (readonly [AgentPanelState, PanelInput])[] = [
      ["choose", CHOOSE],
      ["minting", MINTING],
      ["reveal", REVEAL],
      ["error", FAILED],
      ["revoked", REVOKED],
    ];

    for (const [state, input] of withheld) {
      expect({ state, revokeOffered: (await panelMarkup(input)).includes(label) }).toEqual({
        state,
        revokeOffered: false,
      });
    }
  });

  test("the revoke label names the scope the press has, which is every key the workspace holds", async () => {
    const label = await message("AGENT_REVOKE_LABEL");
    const route = readExisting("apps/web/app/api/first-run/agent/revoke/route.ts").source;

    expect(blankComments(route)).toContain("revokeEveryLive()");

    expect(label.toLowerCase()).toContain("every key");
    expect(label.toLowerCase()).not.toContain("this key");

    expect(buttons(await panelMarkup(CONNECTED)).map((button) => button.text)).toContain(label);
  });

  test("the mint control renders disabled while a mint is in flight", async () => {
    const html = await panelMarkup(MINTING);
    const pending = await message("AGENT_MINT_PENDING");

    const inFlight = buttons(html).filter((button) => button.text.includes(pending));
    expect(inFlight).toHaveLength(1);
    expect(inFlight[0]?.disabled).toBe(true);
  });

  test("a failed mint renders its sentence above a control that is still pressable", async () => {
    const html = await panelMarkup(FAILED);
    const text = textOf(html);

    const failure = await message("AGENT_MINT_FAILED_LINE");
    const mintTemplate = await message("AGENT_MINT_TEMPLATE");
    const mintLabel = fill(mintTemplate, "assistant", displayNameOf("cursor"));

    expect(text).toContain(failure);
    expect(text.indexOf(failure)).toBeLessThan(text.indexOf(mintLabel));

    const primary = buttons(html).filter((button) => button.text.includes(mintLabel));
    expect(primary).toHaveLength(1);
    expect(primary[0]?.disabled).toBe(false);
  });

  test("the polite status strip is mounted in choose, before any state that fills it", async () => {
    const chooseHtml = await panelMarkup(CHOOSE);

    expect(chooseHtml).toContain('aria-live="polite"');
    expect(await panelMarkup(REVEAL)).toContain('aria-live="polite"');

    for (const input of [
      CHOOSE,
      MINTING,
      REVEAL,
      WAITING,
      CONNECTED,
      FAILED,
      REVOKED,
      CONFIRMING,
    ]) {
      expect({
        action: input.action,
        assertive: (await panelMarkup(input)).includes("assertive"),
      }).toEqual({ action: input.action, assertive: false });
    }
  });

  test("a copy is announced, because the accessible name of both copy controls is fixed", async () => {
    const copied = await message("AGENT_KEY_COPIED_ANNOUNCEMENT");
    const blockCopied = await message("AGENT_BLOCK_COPIED_ANNOUNCEMENT");
    const notice = await message("AGENT_KEY_ONCE_NOTICE");

    // Nothing on screen changes an accessible name on copy: the block control's
    // name is a fixed `aria-label` and the command control's a fixed
    // `aria-labelledby`, so this region is the whole of the feedback.
    const quiet = await panelMarkup(REVEAL);
    expect(quiet).not.toContain(copied);
    expect(quiet).not.toContain(blockCopied);

    for (const announcement of [copied, blockCopied]) {
      const html = await panelMarkup(REVEAL, "cursor", false, announcement);
      const text = readMarkup(html).text;

      expect(text).toContain(announcement);

      // The state strip keeps its own sentence: a copy may not overwrite the one
      // warning that says the key is shown once.
      expect(text).toContain(notice);
    }
  });

  test("the announcement rides a polite region of its own, and never an assertive one", async () => {
    const copied = await message("AGENT_KEY_COPIED_ANNOUNCEMENT");
    const html = await panelMarkup(REVEAL, "cursor", false, copied);

    expect([...html.matchAll(/aria-live="polite"/g)].length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("assertive");

    const region = /<[^>]*aria-live="polite"[^>]*>([^<]*)</g;
    const carried = [...html.matchAll(region)].map((match) => match[1] ?? "");
    expect(carried).toContain(copied);
  });

  test("every copy control the body renders is wired to the announcement", async () => {
    const code = blankComments(readFirstRun(AGENT_PANEL_BODY).source);

    const controls = [...code.matchAll(/<Copyable(?:Block|Command)\b[\s\S]*?\/>/g)].map(
      (match) => match[0],
    );
    const keyRows = [...code.matchAll(/<CopyButton\b/g)].length;

    expect(controls).toHaveLength(3);
    expect(keyRows).toBe(1);
    expect(controls.filter((element) => element.includes("onCopied="))).toHaveLength(3);

    // The key's own control is a bare CopyButton, so its wire is the handler.
    expect(code).toMatch(/copy\(\);\s*props\.onCopied\(\);/);

    const island = blankComments(readFirstRun(AGENT_PANEL).source);
    expect(island).toMatch(
      /onCopyKey=\{\(\) => setAnnouncement\(AGENT_KEY_COPIED_ANNOUNCEMENT\)\}/,
    );
    expect(island).toMatch(
      /onCopyBlock=\{\(\) => setAnnouncement\(AGENT_BLOCK_COPIED_ANNOUNCEMENT\)\}/,
    );
  });

  test("the mint announcement is used rather than left as a string no surface reads", async () => {
    const minted = await message("AGENT_MINTED_ANNOUNCEMENT");
    const island = blankComments(readFirstRun(AGENT_PANEL).source);

    expect(island).toMatch(/setAnnouncement\(AGENT_MINTED_ANNOUNCEMENT\)/);
    expect(readMarkup(await panelMarkup(REVEAL, "cursor", false, minted)).text).toContain(minted);
  });

  test("Escape cancels the revoke confirm — a source wire, because no test presses a key here", async () => {
    const code = blankComments(readFirstRun(AGENT_PANEL).source);

    const listener = /addEventListener\("keydown"/.exec(code);
    expect(listener).not.toBeNull();

    const gate = code.slice(0, listener?.index ?? 0);
    expect(gate).toMatch(/action !== "confirming-revoke"[\s\S]{0,400}?"Escape"/);

    expect(code).toMatch(/event\.key === "Escape"[\s\S]{0,80}?setAction\("idle"\)/);
    expect(code).toMatch(/removeEventListener\("keydown"/);

    // The body stays render-pure: the listener belongs to the island (ADD D-12).
    expect(blankComments(readFirstRun(AGENT_PANEL_BODY).source)).not.toMatch(
      /addEventListener|useEffect|useState/,
    );
  });

  test("the focus wire exists in AgentPanel.tsx source — no DOM renderer here, so nothing drives it", async () => {
    const code = blankComments(readFirstRun(AGENT_PANEL).source);

    expect(code).toMatch(/useRef</);

    const calls = [...code.matchAll(/\.focus\(/g)].map((match) => match.index ?? 0);
    expect(calls.length).toBeGreaterThanOrEqual(2);

    const windows = calls.map((index) => code.slice(Math.max(0, index - 500), index + 200));

    expect(windows.filter((window) => /reveal|rawKey|mint/i.test(window)).length).toBeGreaterThan(
      0,
    );
    expect(windows.filter((window) => /confirm|revoke/i.test(window)).length).toBeGreaterThan(0);
  });
});
