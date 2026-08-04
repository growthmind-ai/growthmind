import { LIST_OPEN_FIXES_DEFAULT_ITEMS, MCP_TOOL, MCP_TOOL_NAMES } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { UNAVAILABLE } from "../../lib/mcp/refusals";
import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  rpcRequest,
  sseDataLines,
  KEY_A,
  ORG_A,
} from "./helpers/mcp-fixture";

const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";

const EXPECTED_DIALECT = "draft/2020-12";

const FORBIDDEN_SCHEMA_KEYS = ["~standard", "_def", "parse"] as const;

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function deps(): McpServerDeps {
  return { credentials: CREDENTIALS, reads: fakeReadPort().port };
}

interface AdvertisedTool {
  readonly name: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
}

interface Advertisement {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: string;
  readonly tools: readonly AdvertisedTool[];
}

async function readAdvertisement(): Promise<Advertisement> {
  const print = await fingerprint(
    await handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps()),
  );
  return { ...print, tools: advertisedToolsIn(print.body) };
}

function advertisedToolsIn(body: string): readonly AdvertisedTool[] {
  const payloads = sseDataLines(body);
  if (payloads.length !== 1) {
    return [];
  }

  let message: unknown;
  try {
    message = JSON.parse(payloads[0] as string);
  } catch {
    return [];
  }

  const tools = asRecord(asRecord(message)?.result)?.tools;
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools.flatMap((entry): readonly AdvertisedTool[] => {
    const tool = asRecord(entry);
    if (tool === null || typeof tool.name !== "string") {
      return [];
    }
    return [{ name: tool.name, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }];
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toolNamed(ad: Advertisement, name: string): AdvertisedTool | undefined {
  return ad.tools.find((tool) => tool.name === name);
}

function requiredOf(document: Record<string, unknown> | null): readonly string[] {
  const required = document?.required ?? [];
  return Array.isArray(required) ? required.map((entry) => String(entry)) : [];
}

function forbiddenKeysIn(value: unknown, path = "$"): readonly string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => forbiddenKeysIn(entry, `${path}[${index}]`));
  }

  const record = asRecord(value);
  if (record === null) {
    return [];
  }

  const found: string[] = [];
  for (const [key, nested] of Object.entries(record)) {
    if ((FORBIDDEN_SCHEMA_KEYS as readonly string[]).includes(key)) {
      found.push(`${path}.${key}`);
    }
    found.push(...forbiddenKeysIn(nested, `${path}.${key}`));
  }
  return found;
}

function everyDocument(ad: Advertisement): readonly (Record<string, unknown> | null)[] {
  return ad.tools.flatMap((tool) => [asRecord(tool.inputSchema), asRecord(tool.outputSchema)]);
}

function advertisedNames(ad: Advertisement): readonly string[] {
  return ad.tools.map((tool) => tool.name);
}

describe("WIRE-J1 — every tool advertises an input schema that is a JSON Schema object and never null", () => {
  test("should advertise a non-null object with a type of object for each of the four tools", async () => {
    const ad = await readAdvertisement();

    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    for (const tool of ad.tools) {
      const document = asRecord(tool.inputSchema);
      expect(document).not.toBeNull();
      expect(document?.type).toBe("object");
    }
  });
});

describe("WIRE-J2 — the list input schema is advertised with io input semantics, so a zero-argument call is legal", () => {
  test("should not name limit in required and should carry the default at properties.limit.default", async () => {
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    const document = asRecord(toolNamed(ad, MCP_TOOL.LIST_OPEN_FIXES)?.inputSchema);
    expect(document).not.toBeNull();

    expect(requiredOf(document)).not.toContain("limit");

    const properties = asRecord(document?.properties);
    expect(properties).not.toBeNull();
    expect(asRecord(properties?.limit)?.default).toBe(LIST_OPEN_FIXES_DEFAULT_ITEMS);
  });

  test("should still advertise the required key where a tool genuinely has one", async () => {
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    expect(requiredOf(asRecord(toolNamed(ad, MCP_TOOL.GET_FIX)?.inputSchema))).toEqual(["fixId"]);
    expect(requiredOf(asRecord(toolNamed(ad, MCP_TOOL.GET_FINDING)?.inputSchema))).toEqual([
      "findingId",
    ]);
  });
});

describe("WIRE-J3 — no advertised schema carries the standard-schema key", () => {
  test("should find no standard-schema, _def or parse key anywhere in the six advertised documents", async () => {
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    expect(forbiddenKeysIn(everyDocument(ad))).toEqual([]);
  });

  test("should not carry the standard-schema marker in the raw response text either", async () => {
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    expect(ad.body).not.toContain("~standard");
  });

  test("should find a planted standard-schema key, so the walker cannot pass by going blind", async () => {
    const planted = forbiddenKeysIn({
      tools: [{ name: "control", inputSchema: { properties: { id: { "~standard": {} } } } }],
    });

    expect(planted).toEqual(["$.tools[0].inputSchema.properties.id.~standard"]);
    expect(forbiddenKeysIn({ nested: { deeply: { _def: {} } } })).toEqual(["$.nested.deeply._def"]);
    expect(forbiddenKeysIn({ nested: { parse: () => undefined } })).toEqual(["$.nested.parse"]);
  });
});

describe("WIRE-J4 — registering every tool with its shared Zod schemas does not throw", () => {
  test("should build the handler, register all four tools with both schemas, and answer tools/list", async () => {
    const ad = await readAdvertisement();

    expect(ad.status).toBe(200);
    expect(ad.contentType).toBe(SDK_RENDERED_CONTENT_TYPE);
    expect(ad.body).not.toContain(UNAVAILABLE.message);

    expect(ad.tools).toHaveLength(4);
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    for (const tool of ad.tools) {
      expect(asRecord(tool.inputSchema)).not.toBeNull();
      expect(asRecord(tool.outputSchema)).not.toBeNull();
    }
  });
});

describe("WIRE-J5 — the advertised dialect is draft 2020-12 and needs no conversion", () => {
  test("should name draft 2020-12 in every advertised document's $schema", async () => {
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    const documents = everyDocument(ad);
    expect(documents).toHaveLength(8);

    for (const document of documents) {
      expect(document).not.toBeNull();
      expect(String(document?.$schema)).toContain(EXPECTED_DIALECT);
    }
  });
});

describe("WIRE-J6 — every tool advertises an output schema the client can validate against", () => {
  test("should advertise a non-null object output schema with an object root for all four tools", async () => {
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    for (const tool of ad.tools) {
      const document = asRecord(tool.outputSchema);
      expect(document).not.toBeNull();

      expect(document?.type).toBe("object");
    }
  });

  test("should advertise an output schema for the list tool that names its two required halves", async () => {
    const ad = await readAdvertisement();
    expect(advertisedNames(ad)).toEqual([...MCP_TOOL_NAMES]);

    const document = asRecord(toolNamed(ad, MCP_TOOL.LIST_OPEN_FIXES)?.outputSchema);
    expect(document).not.toBeNull();
    expect(requiredOf(document).toSorted()).toEqual(["fixes", "window"]);
  });
});
