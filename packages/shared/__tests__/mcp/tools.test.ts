import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  MCP_TOOL,
  MCP_TOOL_NAME_PATTERN,
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  mcpToolNameSchema,
  resolveMcpTool,
} from "../../src/mcp/tools";
import {
  FINDING_EVIDENCE_MAX_ITEMS,
  FIX_ATTEMPT_CEILING,
  LIST_OPEN_FIXES_DEFAULT_ITEMS,
  LIST_OPEN_FIXES_MAX_ITEMS,
  fixSpecEnvelopeSchema,
  getFindingInputSchema,
  getFindingOutputSchema,
  getFixInputSchema,
  listOpenFixesInputSchema,
  listOpenFixesOutputSchema,
  mcpMeasuredCountSchema,
  openFixSummarySchema,
} from "../../src/mcp/types";
import { FORBIDDEN_PRODUCT_JARGON } from "../../src/signatures/messages";

const WINDOW = { start: "2026-07-01T00:00:00.000Z", end: "2026-07-08T00:00:00.000Z" };

type SetAsideRow = { readonly reason: string; readonly count: number; readonly label: string };

function count(numerator: number, kept: number, setAside: readonly SetAsideRow[] = []) {
  const setAsideTotal = setAside.reduce((sum, row) => sum + row.count, 0);
  return {
    numerator,
    denominator: kept,
    unit: "sessions",
    timeframe: WINDOW,
    basis: { totalInWindow: kept + setAsideTotal, kept, setAside },
  };
}

function openFix(fixId: string) {
  return {
    fixId,
    findingId: `finding_${fixId}`,
    summary: "The send button on the invite screen does not fire its request.",
    impact: count(289, 289),
    openedAt: "2026-07-08T09:00:00.000Z",
    resultsBy: "2026-08-11T09:00:00.000Z",
    status: "open",
  };
}

function fixList(size: number) {
  const fixes = Array.from({ length: size }, (_unused, index) => openFix(`fix_${String(index)}`));
  return { fixes, window: { returned: size, totalOpen: size, truncated: false } };
}

const FIX_ENVELOPE = {
  fixId: "fix_1",
  findingId: "finding_1",
  status: "open",
  specText: "Change\n  The send button on the invite screen does not fire its request.",
  attempt: 1,
  attemptsAllowed: FIX_ATTEMPT_CEILING,
  alreadyLanded: [],
  impact: count(289, 289),
  resultsBy: "2026-08-11T09:00:00.000Z",
  dateIsFinal: true,
};

const FINDING = {
  findingId: "finding_1",
  fixId: null,
  headline: "Nobody who opened the invite screen got an invite sent.",
  detail: "The request never leaves the page. We saw the click and we did not see the call.",
  surface: { name: "the invite screen", path: "src/invite/Send.tsx" },
  affected: count(289, 289),
  firstSeenAt: "2026-07-01T09:00:00.000Z",
  lastSeenAt: "2026-07-08T09:00:00.000Z",
  evidence: [
    { kind: "session_replay", label: "A session where the button did nothing.", url: null },
  ],
};

function collectKeys(schema: unknown, into: string[], seen: Set<object>): void {
  if (schema === null || typeof schema !== "object" || seen.has(schema)) {
    return;
  }
  seen.add(schema);

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const key of Object.keys(shape)) {
      into.push(key);
      collectKeys(shape[key], into, seen);
    }
    return;
  }

  if (schema instanceof z.ZodOptional) {
    collectKeys(schema.unwrap(), into, seen);
    return;
  }
  if (schema instanceof z.ZodNullable) {
    collectKeys(schema.unwrap(), into, seen);
    return;
  }
  if (schema instanceof z.ZodDefault) {
    collectKeys(schema.unwrap(), into, seen);
    return;
  }
  if (schema instanceof z.ZodReadonly) {
    collectKeys(schema.unwrap(), into, seen);
    return;
  }
  if (schema instanceof z.ZodArray) {
    collectKeys(schema.element, into, seen);
    return;
  }
  if (schema instanceof z.ZodUnion) {
    for (const option of schema.options) {
      collectKeys(option, into, seen);
    }
  }
}

function inputKeysOf(): readonly string[] {
  const keys: string[] = [];
  for (const tool of MCP_TOOLS) {
    collectKeys(tool.inputSchema, keys, new Set());
  }
  return keys;
}

describe("MCP tool identity", () => {
  test("exposes exactly list_open_fixes, get_fix and get_finding, by those literal names", () => {
    expect(MCP_TOOL.LIST_OPEN_FIXES).toBe("list_open_fixes");
    expect(MCP_TOOL.GET_FIX).toBe("get_fix");
    expect(MCP_TOOL.GET_FINDING).toBe("get_finding");

    expect(MCP_TOOLS.map((tool) => tool.name).toSorted()).toEqual([
      "get_finding",
      "get_fix",
      "list_open_fixes",
    ]);
  });

  test("every tool name is unique", () => {
    const names = MCP_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(MCP_TOOL_NAMES).size).toBe(MCP_TOOL_NAMES.length);
  });

  test("every tool name matches the MCP name grammar", () => {
    expect(MCP_TOOL_NAMES.length).toBeGreaterThan(0);
    for (const name of MCP_TOOL_NAMES) {
      expect(MCP_TOOL_NAME_PATTERN.test(name)).toBe(true);
    }

    expect(MCP_TOOL_NAME_PATTERN.test("List_Open_Fixes")).toBe(false);
    expect(MCP_TOOL_NAME_PATTERN.test("list-open-fixes")).toBe(false);
    expect(MCP_TOOL_NAME_PATTERN.test("2fixes")).toBe(false);
  });

  test("the name enum and the descriptor list name the same set of tools", () => {
    expect(mcpToolNameSchema.options.toSorted()).toEqual(
      MCP_TOOLS.map((tool) => tool.name).toSorted(),
    );
  });

  test("every tool carries an input schema, an output schema and a title", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema).toBeInstanceOf(z.ZodObject);
      expect(tool.outputSchema).toBeInstanceOf(z.ZodType);
      expect(tool.title.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("resolving a tool name off the wire", () => {
  test("an unknown tool name is refused with instructions, never ignored", () => {
    for (const unknown of ["get_fixes", "report_shipped", "", "LIST_OPEN_FIXES", "get_events"]) {
      const resolution = resolveMcpTool(unknown);
      expect(resolution.ok).toBe(false);
      if (resolution.ok) {
        throw new Error("unreachable: an unknown tool name must not resolve");
      }
      expect(resolution.code).toBe("unknown_tool");

      expect(resolution.message).toContain(unknown === "" ? '""' : unknown);
      expect(resolution.message).toContain("list_open_fixes");
      expect(resolution.knownTools.toSorted()).toEqual([...MCP_TOOL_NAMES].toSorted());
    }
  });

  test("every known tool name resolves to its own descriptor", () => {
    for (const name of MCP_TOOL_NAMES) {
      const resolution = resolveMcpTool(name);
      expect(resolution.ok).toBe(true);
      if (!resolution.ok) {
        throw new Error(`unreachable: ${name} must resolve`);
      }
      expect(resolution.tool.name).toBe(name);
    }
  });
});

const MUTATION_STEMS = [
  "creat",
  "delet",
  "updat",
  "writ",
  "modif",
  "remov",
  "dispatch",
  "chang",
  "send",
  "sent",
  "post",
  "mark",
  "clos",
  "resolv",
  "set",
  "ship",
  "edit",
  "insert",
  "upsert",
  "patch",
  "push",
  "mutat",
] as const;

function mutationStemIn(text: string): string | null {
  const lower = text.toLowerCase().replace(/[_-]/g, " ");
  for (const stem of MUTATION_STEMS) {
    if (new RegExp(`\\b${stem}\\w*\\b`).test(lower)) {
      return stem;
    }
  }
  return null;
}

describe("this surface is read-only", () => {
  test("every tool declares itself read-only", () => {
    expect(MCP_TOOLS.length).toBeGreaterThan(0);
    for (const tool of MCP_TOOLS) {
      expect(tool.readOnlyHint).toBe(true);
    }
  });

  test("there is no write tool in the exported list", () => {
    const names: readonly string[] = MCP_TOOLS.map((tool) => tool.name);
    expect(names).not.toContain("report_shipped");
    expect(MCP_TOOLS.length).toBe(3);
  });

  test("no tool name or description offers to change anything", () => {
    for (const tool of MCP_TOOLS) {
      expect(mutationStemIn(tool.name)).toBeNull();
      expect(mutationStemIn(tool.title)).toBeNull();
      expect(mutationStemIn(tool.description)).toBeNull();
    }

    expect(mutationStemIn("Creates a fix and posts it to Slack.")).not.toBeNull();
    expect(mutationStemIn("report_shipped")).not.toBeNull();
  });
});

describe("tool descriptions", () => {
  test("no product jargon in any tool description", () => {
    expect(FORBIDDEN_PRODUCT_JARGON.length).toBeGreaterThan(0);

    for (const tool of MCP_TOOLS) {
      const text = `${tool.title} ${tool.description}`.toLowerCase();
      for (const word of FORBIDDEN_PRODUCT_JARGON) {
        expect(text).not.toContain(word);
      }
    }

    const banned: readonly string[] = FORBIDDEN_PRODUCT_JARGON;
    expect(banned.toSorted()).toEqual([
      "candidate",
      "dedup",
      "hash",
      "ledger",
      "policy",
      "signature",
      "suppression",
    ]);
  });

  test("every description tells a model what it gets back and when to reach for it", () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(120);
      expect(tool.description.toLowerCase()).toContain("you");
    }

    const byName = new Map(MCP_TOOLS.map((tool) => [tool.name, tool.description.toLowerCase()]));
    expect(byName.get("list_open_fixes")).toContain("do not already have an id");
    expect(byName.get("get_fix")).toContain("before you touch any code");
    expect(byName.get("get_finding")).toContain("before working on it");
  });

  test("the list tool states its own ceiling, so a short answer is never read as everything", () => {
    const description = byNameDescription("list_open_fixes");
    expect(description).toContain(String(LIST_OPEN_FIXES_MAX_ITEMS));
    expect(description.toLowerCase()).toContain("at most");
  });
});

function byNameDescription(name: string): string {
  const tool = MCP_TOOLS.find((entry) => entry.name === name);
  if (tool === undefined) {
    throw new Error(`no descriptor for ${name}`);
  }
  return tool.description;
}

describe("tool inputs — the organization is never an argument", () => {
  const TENANT_KEY = /(^|[^a-z])(org|orgs|organization|organisation|tenant|workspace|account)/i;

  test("no tool input schema declares an organization key at any depth", () => {
    const keys = inputKeysOf();
    const offenders = keys.filter((key) => TENANT_KEY.test(key));

    expect(offenders).toEqual([]);
  });

  test("no tool input schema names an actor either", () => {
    const ACTOR_KEY = /(^|[^a-z])(user|member|actor|email|owner)/i;
    expect(inputKeysOf().filter((key) => ACTOR_KEY.test(key))).toEqual([]);
  });

  test("the key walk reaches the keys it claims to check", () => {
    const keys = inputKeysOf();
    expect(keys.toSorted()).toEqual(["findingId", "fixId", "limit", "projectId"]);
  });

  test("the key walk descends through optionals, defaults, arrays and readonly wrappers", () => {
    const nested = z.object({
      plain: z.string(),
      optional: z.object({ insideOptional: z.string() }).optional(),
      defaulted: z.object({ insideDefault: z.string() }).default({ insideDefault: "x" }),
      list: z.array(z.object({ insideArray: z.string() })).readonly(),
      either: z.union([
        z.object({ insideUnionA: z.string() }),
        z.object({ insideUnionB: z.string() }),
      ]),
      nullableOne: z.object({ insideNullable: z.string() }).nullable(),
    });

    const keys: string[] = [];
    collectKeys(nested, keys, new Set());

    for (const expected of [
      "insideOptional",
      "insideDefault",
      "insideArray",
      "insideUnionA",
      "insideUnionB",
      "insideNullable",
    ]) {
      expect(keys).toContain(expected);
    }
  });

  test("an organization id passed anyway is dropped, never honoured", () => {
    const parsed = listOpenFixesInputSchema.parse({ organizationId: "org_someone_else", limit: 5 });
    expect(Object.hasOwn(parsed, "organizationId")).toBe(false);
    expect(parsed.limit).toBe(5);
  });
});

describe("list_open_fixes is bounded by its schema", () => {
  test("the limit is accepted at the maximum and refused above it", () => {
    expect(listOpenFixesInputSchema.safeParse({ limit: LIST_OPEN_FIXES_MAX_ITEMS }).success).toBe(
      true,
    );
    expect(
      listOpenFixesInputSchema.safeParse({ limit: LIST_OPEN_FIXES_MAX_ITEMS + 1 }).success,
    ).toBe(false);
    expect(listOpenFixesInputSchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(listOpenFixesInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listOpenFixesInputSchema.safeParse({ limit: -1 }).success).toBe(false);
    expect(listOpenFixesInputSchema.safeParse({ limit: 2.5 }).success).toBe(false);
    expect(listOpenFixesInputSchema.safeParse({ limit: 1000 }).success).toBe(false);
  });

  test("a call with no arguments is already bounded", () => {
    const parsed = listOpenFixesInputSchema.parse({});
    expect(parsed.limit).toBe(LIST_OPEN_FIXES_DEFAULT_ITEMS);
    expect(LIST_OPEN_FIXES_DEFAULT_ITEMS).toBe(LIST_OPEN_FIXES_MAX_ITEMS);
  });

  test("the response array is bounded independently of the request", () => {
    expect(listOpenFixesOutputSchema.safeParse(fixList(LIST_OPEN_FIXES_MAX_ITEMS)).success).toBe(
      true,
    );
    expect(
      listOpenFixesOutputSchema.safeParse(fixList(LIST_OPEN_FIXES_MAX_ITEMS + 1)).success,
    ).toBe(false);
  });

  test("a truncated list must say it was cut short", () => {
    const trimmed = {
      fixes: [openFix("fix_1")],
      window: { returned: 1, totalOpen: 40, truncated: false },
    };
    expect(listOpenFixesOutputSchema.safeParse(trimmed).success).toBe(false);

    const honest = {
      fixes: [openFix("fix_1")],
      window: { returned: 1, totalOpen: 40, truncated: true },
    };
    expect(listOpenFixesOutputSchema.safeParse(honest).success).toBe(true);

    const overclaimed = {
      fixes: [openFix("fix_1")],
      window: { returned: 1, totalOpen: 1, truncated: true },
    };
    expect(listOpenFixesOutputSchema.safeParse(overclaimed).success).toBe(false);
  });

  test("the stated count must match the entries actually sent", () => {
    const lying = {
      fixes: [openFix("fix_1"), openFix("fix_2")],
      window: { returned: 1, totalOpen: 2, truncated: true },
    };
    expect(listOpenFixesOutputSchema.safeParse(lying).success).toBe(false);
  });

  test("a response may not carry more entries than exist", () => {
    const impossible = {
      fixes: [openFix("fix_1"), openFix("fix_2")],
      window: { returned: 2, totalOpen: 1, truncated: false },
    };
    expect(listOpenFixesOutputSchema.safeParse(impossible).success).toBe(false);
  });

  test("a list of open fixes can only contain open fixes", () => {
    for (const status of ["awaiting_verification", "verified", "withdrawn"]) {
      const wrong = { ...openFix("fix_1"), status };
      expect(openFixSummarySchema.safeParse(wrong).success).toBe(false);
    }
    expect(openFixSummarySchema.safeParse(openFix("fix_1")).success).toBe(true);
  });
});

describe("empty and zero are well-formed answers", () => {
  test("an empty list of open fixes is a valid response, not an error", () => {
    const parsed = listOpenFixesOutputSchema.safeParse({
      fixes: [],
      window: { returned: 0, totalOpen: 0, truncated: false },
    });
    expect(parsed.success).toBe(true);
  });

  test("a count where every session was set aside parses, with a zero denominator", () => {
    const everythingSetAside = count(0, 0, [
      { reason: "automation_headless", count: 9, label: "Automated traffic" },
      { reason: "internal_domain", count: 3, label: "Your own team" },
    ]);
    const parsed = mcpMeasuredCountSchema.safeParse(everythingSetAside);
    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      throw new Error("unreachable");
    }
    expect(parsed.data.denominator).toBe(0);
    expect(parsed.data.basis.totalInWindow).toBe(12);
  });

  test("a count of nothing in a window of nothing parses", () => {
    expect(mcpMeasuredCountSchema.safeParse(count(0, 0)).success).toBe(true);
  });
});

describe("every count on this surface carries its denominator", () => {
  test("a count missing its denominator or its basis is refused", () => {
    expect(
      mcpMeasuredCountSchema.safeParse({
        numerator: 3,
        unit: "sessions",
        timeframe: WINDOW,
        basis: { totalInWindow: 28, kept: 28, setAside: [] },
      }).success,
    ).toBe(false);

    expect(
      mcpMeasuredCountSchema.safeParse({
        numerator: 3,
        denominator: 28,
        unit: "sessions",
        timeframe: WINDOW,
      }).success,
    ).toBe(false);
  });

  test("a basis that does not account for every session in the window is refused", () => {
    const unaccounted = {
      ...count(3, 28),
      basis: { totalInWindow: 40, kept: 28, setAside: [] },
    };
    expect(mcpMeasuredCountSchema.safeParse(unaccounted).success).toBe(false);
  });

  test("a denominator that is not the basis's kept sessions is refused", () => {
    const mismatched = { ...count(3, 28), denominator: 40 };
    expect(mcpMeasuredCountSchema.safeParse(mismatched).success).toBe(false);
  });

  test("a numerator may never exceed its denominator", () => {
    expect(mcpMeasuredCountSchema.safeParse(count(35, 28)).success).toBe(false);
    expect(mcpMeasuredCountSchema.safeParse(count(28, 28)).success).toBe(true);
  });

  test("a count in people rather than sessions is refused", () => {
    const people = { ...count(3, 28), unit: "people" };
    expect(mcpMeasuredCountSchema.safeParse(people).success).toBe(false);
  });

  test("a timeframe that ends before it starts is refused", () => {
    const inverted = {
      ...count(3, 28),
      timeframe: { start: WINDOW.end, end: WINDOW.start },
    };
    expect(mcpMeasuredCountSchema.safeParse(inverted).success).toBe(false);
  });

  test("a timeframe carrying a numeric offset rather than UTC is refused", () => {
    const offset = {
      ...count(3, 28),
      timeframe: { start: "2026-07-01T00:00:00+01:00", end: "2026-07-08T00:00:00+01:00" },
    };
    expect(mcpMeasuredCountSchema.safeParse(offset).success).toBe(false);
  });
});

describe("every response carries both ids", () => {
  test("a fix summary, a fix envelope and a finding all name their fix and their finding", () => {
    expect(Object.keys(openFixSummarySchema.shape)).toContain("fixId");
    expect(Object.keys(openFixSummarySchema.shape)).toContain("findingId");

    const envelope = fixSpecEnvelopeSchema.safeParse(FIX_ENVELOPE);
    expect(envelope.success).toBe(true);
    if (!envelope.success) {
      throw new Error("unreachable");
    }
    expect(envelope.data.fixId).toBe("fix_1");
    expect(envelope.data.findingId).toBe("finding_1");

    const finding = getFindingOutputSchema.safeParse(FINDING);
    expect(finding.success).toBe(true);
  });

  test("a finding with no fix yet says so with null, never by omitting the field", () => {
    expect(getFindingOutputSchema.safeParse({ ...FINDING, fixId: null }).success).toBe(true);

    const { fixId: _omittedOnPurpose, ...withoutKey } = FINDING;
    expect(getFindingOutputSchema.safeParse(withoutKey).success).toBe(false);
  });

  test("an id must be a non-empty string", () => {
    expect(getFixInputSchema.safeParse({ fixId: "" }).success).toBe(false);
    expect(getFixInputSchema.safeParse({}).success).toBe(false);
    expect(getFindingInputSchema.safeParse({ findingId: "" }).success).toBe(false);
    expect(getFindingInputSchema.safeParse({ findingId: "finding_1" }).success).toBe(true);
  });
});

describe("the fix envelope", () => {
  test("a first attempt cannot claim earlier work", () => {
    const impossible = { ...FIX_ENVELOPE, attempt: 1, alreadyLanded: ["The request now fires."] };
    expect(fixSpecEnvelopeSchema.safeParse(impossible).success).toBe(false);
  });

  test("a later attempt narrows around what already landed", () => {
    const second = { ...FIX_ENVELOPE, attempt: 2, alreadyLanded: ["The request now fires."] };
    expect(fixSpecEnvelopeSchema.safeParse(second).success).toBe(true);
  });

  test("an attempt beyond the ceiling is refused", () => {
    expect(FIX_ATTEMPT_CEILING).toBe(3);
    expect(
      fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, attempt: FIX_ATTEMPT_CEILING }).success,
    ).toBe(true);
    expect(
      fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, attempt: FIX_ATTEMPT_CEILING + 1 })
        .success,
    ).toBe(false);
    expect(fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, attempt: 0 }).success).toBe(false);
  });

  test("the ceiling is stated on every envelope and cannot be understated", () => {
    expect(fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, attemptsAllowed: 5 }).success).toBe(
      false,
    );
  });

  test("the results date is always stated as final", () => {
    expect(fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, dateIsFinal: false }).success).toBe(
      false,
    );
  });

  test("a fix envelope carries the spec as sentences, and refuses an empty one", () => {
    expect(fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, specText: "" }).success).toBe(false);
  });

  test("an envelope for a withdrawn or verified fix still parses", () => {
    for (const status of ["awaiting_verification", "verified", "withdrawn"]) {
      expect(fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, status }).success).toBe(true);
    }
    expect(fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, status: "in_review" }).success).toBe(
      false,
    );
  });
});

describe("the finding response", () => {
  test("a finding with no evidence is refused", () => {
    expect(getFindingOutputSchema.safeParse({ ...FINDING, evidence: [] }).success).toBe(false);
  });

  test("evidence beyond the ceiling is refused", () => {
    const one = { kind: "session_replay", label: "A session where nothing happened.", url: null };
    const atCeiling = Array.from({ length: FINDING_EVIDENCE_MAX_ITEMS }, () => one);
    expect(getFindingOutputSchema.safeParse({ ...FINDING, evidence: atCeiling }).success).toBe(
      true,
    );
    expect(
      getFindingOutputSchema.safeParse({ ...FINDING, evidence: [...atCeiling, one] }).success,
    ).toBe(false);
  });

  test("a surface that does not resolve to a file says so with null, never with a guess", () => {
    const unresolved = { ...FINDING, surface: { name: "the invite screen", path: null } };
    expect(getFindingOutputSchema.safeParse(unresolved).success).toBe(true);

    const empty = { ...FINDING, surface: { name: "the invite screen", path: "" } };
    expect(getFindingOutputSchema.safeParse(empty).success).toBe(false);
  });

  test("an unknown kind of evidence is refused", () => {
    const unknown = {
      ...FINDING,
      evidence: [{ kind: "screenshot", label: "Something.", url: null }],
    };
    expect(getFindingOutputSchema.safeParse(unknown).success).toBe(false);
  });

  test("an evidence link must be a real link or explicitly absent", () => {
    const linked = {
      ...FINDING,
      evidence: [
        {
          kind: "network_request",
          label: "The call that never left the page.",
          url: "https://example.test/session/1",
        },
      ],
    };
    expect(getFindingOutputSchema.safeParse(linked).success).toBe(true);

    const broken = {
      ...FINDING,
      evidence: [{ kind: "network_request", label: "The call.", url: "not-a-link" }],
    };
    expect(getFindingOutputSchema.safeParse(broken).success).toBe(false);
  });
});
