import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LATEST_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";
import { MCP_TOOL } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { handleMcpRequest, type McpServerDeps } from "../../lib/mcp/server";
import {
  JSON_RPC_ERROR_CODE,
  MCP_HEADER,
  MCP_PROTOCOL_ERA_TARGET,
  MCP_PROTOCOL_LEGACY_FLOOR,
} from "../../lib/mcp/wire-constants";
import {
  fakeCredentials,
  fakeReadPort,
  fingerprint,
  rpcRequest,
  toolCallRequest,
  verbRequest,
  KEY_A,
  ORG_A,
} from "./helpers/mcp-fixture";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

const SERVER_SRC = "apps/web/lib/mcp/server.ts";
const WIRE_SRC = "apps/web/lib/mcp/wire.ts";

function sourceOf(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

const RESPONSE_MODE_PIN = 'responseMode: "sse"';

function codeOnly(source: string): string {
  const out: string[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];

    if (char === "/" && next === "/") {
      const stop = source.indexOf("\n", index);
      const end = stop === -1 ? source.length : stop;
      out.push(" ".repeat(end - index));
      index = end;
      continue;
    }

    if (char === "/" && next === "*") {
      const stop = source.indexOf("*/", index + 2);
      const end = stop === -1 ? source.length : stop + 2;
      for (let i = index; i < end; i += 1) {
        out.push(source[i] === "\n" ? "\n" : " ");
      }
      index = end;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === char) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      const end = Math.min(cursor, source.length);
      out.push(source.slice(index, end));
      index = end;
      continue;
    }

    out.push(char);
    index += 1;
  }

  return out.join("");
}

describe("WIRE-K1 — every header name and error code this surface names is an exported constant, never an inline literal", () => {
  const HOISTED_VALUES: readonly string[] = [
    ...Object.values(MCP_HEADER),
    MCP_PROTOCOL_LEGACY_FLOOR,
    MCP_PROTOCOL_ERA_TARGET,
  ];

  const FRAMING_MODES = ["auto", "sse", "json"] as const;

  const EXEMPT_INLINE_LITERALS = [RESPONSE_MODE_PIN] as const;

  function inlineOffences(source: string, exempt: readonly string[]): readonly string[] {
    let code = codeOnly(source);
    for (const phrase of exempt) {
      code = code.split(phrase).join(" ");
    }

    const offences: string[] = [];

    for (const value of [...HOISTED_VALUES, ...FRAMING_MODES]) {
      for (const quote of ['"', "'", "`"]) {
        const literal = `${quote}${value}${quote}`;
        if (code.includes(literal)) {
          offences.push(literal);
        }
      }
    }

    for (const match of code.match(/-32\d{3}\b/g) ?? []) {
      offences.push(match);
    }

    return offences.toSorted();
  }

  test("server.ts writes no header name, revision or error code inline", () => {
    expect(inlineOffences(sourceOf(SERVER_SRC), EXEMPT_INLINE_LITERALS)).toEqual([]);
  });

  test("wire.ts writes none either, apart from the one exempt framing literal", () => {
    expect(inlineOffences(sourceOf(WIRE_SRC), EXEMPT_INLINE_LITERALS)).toEqual([]);
  });

  test("the construction-site literal is an offence without the exemption and clean with it", () => {
    const site = `const handler = createMcpHandler(factory, { ${RESPONSE_MODE_PIN}, legacy: "stateless" });`;

    expect(inlineOffences(site, [])).toEqual(['"sse"']);
    expect(inlineOffences(site, EXEMPT_INLINE_LITERALS)).toEqual([]);
  });

  test("the scanner finds what it is looking for in a known-positive control, and ignores prose", () => {
    const guilty = [
      `const name = "${MCP_HEADER.SESSION_ID}";`,
      "const code = -32601;",
      `const era = "${MCP_PROTOCOL_ERA_TARGET}";`,
    ].join("\n");

    expect(inlineOffences(guilty, EXEMPT_INLINE_LITERALS)).toEqual([
      `"${MCP_PROTOCOL_ERA_TARGET}"`,
      `"${MCP_HEADER.SESSION_ID}"`,
      "-32601",
    ]);

    const innocent = `// never write "${MCP_HEADER.SESSION_ID}" or -32601 or "${MCP_PROTOCOL_ERA_TARGET}" inline\nconst a = 1;`;
    expect(inlineOffences(innocent, EXEMPT_INLINE_LITERALS)).toEqual([]);

    expect(HOISTED_VALUES.length).toBeGreaterThan(0);
  });
});

function inABannedBand(code: number): boolean {
  return (code >= -32099 && code <= -32020) || (code >= -32019 && code <= -32000);
}

describe("WIRE-K2 — no emitted error code falls in the spec-reserved or legacy bands", () => {
  test("every code in JSON_RPC_ERROR_CODE is outside both bands", () => {
    const entries = Object.entries(JSON_RPC_ERROR_CODE);

    expect(entries.length).toBeGreaterThan(0);

    for (const [name, code] of entries) {
      expect({ name, banned: inABannedBand(code) }).toEqual({ name, banned: false });
    }
  });

  test("the band check fires on a reserved code and on a legacy one", () => {
    expect(inABannedBand(-32050)).toBe(true);
    expect(inABannedBand(-32010)).toBe(true);
    expect(inABannedBand(JSON_RPC_ERROR_CODE.PARSE_ERROR)).toBe(false);
    expect(inABannedBand(JSON_RPC_ERROR_CODE.METHOD_NOT_FOUND)).toBe(false);
  });
});

const SUPPORTED: readonly string[] = SUPPORTED_PROTOCOL_VERSIONS;

describe("WIRE-K3 — the legacy revision this server serves is one the package still negotiates", () => {
  test("SUPPORTED_PROTOCOL_VERSIONS contains the legacy floor this surface pins", () => {
    expect(SUPPORTED).toContain(MCP_PROTOCOL_LEGACY_FLOOR);
  });
});

describe("WIRE-K4 — the legacy negotiation list is pinned, so a package upgrade cannot move what this server negotiates", () => {
  test("the package's latest revision and its whole supported list are the measured ones", () => {
    expect(LATEST_PROTOCOL_VERSION).toBe("2025-11-25");
    expect([...SUPPORTED_PROTOCOL_VERSIONS]).toEqual([
      "2025-11-25",
      "2025-06-18",
      "2025-03-26",
      "2024-11-05",
      "2024-10-07",
    ]);
  });
});

describe("WIRE-K5 — the modern era is absent from the LEGACY NEGOTIATION LIST on purpose", () => {
  test("the era target is not in the legacy list", () => {
    expect(SUPPORTED).not.toContain(MCP_PROTOCOL_ERA_TARGET);
  });
});

const CREDENTIALS = fakeCredentials({ [KEY_A]: ORG_A });

function deps(): McpServerDeps {
  return { credentials: CREDENTIALS, reads: fakeReadPort().port };
}

const SDK_RENDERED_CONTENT_TYPE = "text/event-stream";
const PRE_SDK_CONTENT_TYPE = "application/json;charset=utf-8";

const BAND_CASES: readonly {
  readonly name: string;
  readonly status: number;
  readonly contentType: string;
  readonly run: () => Promise<Response>;
}[] = [
  {
    name: "a tools/list",
    status: 200,
    contentType: SDK_RENDERED_CONTENT_TYPE,
    run: () => handleMcpRequest(rpcRequest({ method: "tools/list", key: KEY_A }), deps()),
  },
  {
    name: "a tools/call",
    status: 200,
    contentType: SDK_RENDERED_CONTENT_TYPE,
    run: () =>
      handleMcpRequest(toolCallRequest({ tool: MCP_TOOL.LIST_OPEN_FIXES, key: KEY_A }), deps()),
  },
  {
    name: "a not-found tool error",
    status: 200,
    contentType: SDK_RENDERED_CONTENT_TYPE,
    run: () =>
      handleMcpRequest(
        toolCallRequest({ tool: MCP_TOOL.GET_FIX, input: { fixId: "no-such-fix" }, key: KEY_A }),
        deps(),
      ),
  },
  {
    name: "an unauthenticated refusal",
    status: 401,
    contentType: PRE_SDK_CONTENT_TYPE,
    run: () => handleMcpRequest(rpcRequest({ method: "tools/list" }), deps()),
  },
  {
    name: "a wrong-method refusal",
    status: 405,
    contentType: PRE_SDK_CONTENT_TYPE,
    run: () => handleMcpRequest(verbRequest({ method: "DELETE", key: KEY_A }), deps()),
  },
];

describe("WIRE-K6 — the wire is SSE-framed on the SDK path and JSON on the pre-SDK path, because the response mode is written out rather than defaulted", () => {
  test("(a) wire.ts writes the response mode as a property at the construction site", () => {
    expect(codeOnly(sourceOf(WIRE_SRC))).toContain(RESPONSE_MODE_PIN);
  });

  test("(a) a commented pin does not satisfy the scan and a written one does", () => {
    expect(codeOnly(`// ${RESPONSE_MODE_PIN} is the pin\nconst a = 1;`)).not.toContain(
      RESPONSE_MODE_PIN,
    );
    expect(codeOnly(`const options = { ${RESPONSE_MODE_PIN} };`)).toContain(RESPONSE_MODE_PIN);
  });

  for (const { name, status, contentType, run } of BAND_CASES) {
    test(`(b) ${name} carries ${contentType}`, async () => {
      const print = await fingerprint(await run());

      expect(print.status).toBe(status);
      expect(print.contentType).toBe(contentType);
    });
  }

  for (const { name, status, run } of BAND_CASES) {
    test(`(c) ${name} contains no line beginning id:`, async () => {
      const print = await fingerprint(await run());

      expect(print.status).toBe(status);
      expect(linesBeginningWithId(print.body)).toEqual([]);
    });
  }

  test("(c) the scanner finds an id: line in a control frame that has one", () => {
    const withId = "event: message\nid: 42\ndata: {}\n\n";
    const without = 'event: message\ndata: {"jsonrpc":"2.0","id":1}\n\n';

    expect(linesBeginningWithId(withId)).toEqual(["id: 42"]);

    expect(linesBeginningWithId(without)).toEqual([]);
  });
});

function linesBeginningWithId(body: string): readonly string[] {
  return body.split("\n").filter((line) => line.startsWith("id:"));
}
