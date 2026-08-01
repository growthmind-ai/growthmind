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

// Invariants for the read-only machine surface. Test names are the contract: a row here
// that stops existing is a capability that stopped being guaranteed, so do not rename
// one without deciding to change the guarantee.
//
// The banned vocabulary is imported, never re-listed, `FORBIDDEN_PRODUCT_JARGON` lives
// in `src/signatures/messages.ts` and is the same list the Slack strings and the
// delivery messages are held to. A second list here would pass by scanning for less,
// which is the only way a jargon audit ever goes green wrongly.

// Fixtures

const WINDOW = { start: "2026-07-01T00:00:00.000Z", end: "2026-07-08T00:00:00.000Z" };

type SetAsideRow = { readonly reason: string; readonly count: number; readonly label: string };

/** A well-formed wire count: `numerator` of `kept`, with the window accounted for. */
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

// The recursive key walk, used by the org-absence invariants below.

/**
 * Every property name reachable inside a schema, at any depth, through optionals,
 * defaults, arrays, readonly wrappers and unions.
 *
 * Schema-level rather than source-level, on purpose. The source scan in
 * `packages/db/__tests__/repositories/no-org-param.test.ts` is the right tool for
 * function parameters, where the thing being audited is text. Here the thing being
 * audited is a value we can hold, so the walk is total by construction: it cannot be
 * defeated by a key written in an unusual position, a schema composed from another
 * file, or a `.extend` somebody adds later.
 */
function collectKeys(schema: unknown, into: string[], seen: Set<object>): void {
  // `unknown` rather than `z.ZodType`, deliberately. Zod's own unwrapping accessors
  // return the internal base type, so a typed walk would need a cast at every hop, and
  // a cast is the one thing that could make this walk lie about what it descended into.
  // Every step below is an `instanceof` guard, so the walk is as true at runtime as it
  // claims to be.
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

// Tool identity, the wire contract

describe("MCP tool identity", () => {
  test("exposes exactly list_open_fixes, get_fix and get_finding, by those literal names", () => {
    // The literals, spelled out. A rename is not a compile error anywhere and not a
    // runtime error either. It is a capability that silently stops being reachable,
    // because a client asks for a tool by string. This is the only place that can
    // notice.
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
    // Non-vacuity: the pattern rejects the shapes it is meant to reject.
    expect(MCP_TOOL_NAME_PATTERN.test("List_Open_Fixes")).toBe(false);
    expect(MCP_TOOL_NAME_PATTERN.test("list-open-fixes")).toBe(false);
    expect(MCP_TOOL_NAME_PATTERN.test("2fixes")).toBe(false);
  });

  test("the name enum and the descriptor list name the same set of tools", () => {
    // A name in the enum with no descriptor is a tool a client can ask for and never
    // reach; a descriptor with no name in the enum is a tool that exists and is
    // unaddressable. Both are the failure, in opposite directions.
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
      // Errors instruct. A refusal that only says "no" leaves the agent guessing at
      // spellings and burning the customer's tokens doing it.
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

// Read-only

/**
 * Stems, matched at a word boundary with any suffix, so "create", "creates" and
 * "creating" are one row. A plain substring scan would fire on innocent words ("set"
 * inside "settings") and miss inflections, which is how a ban list ends up either noisy
 * or vacuous.
 */
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
  // Underscores are word characters, so `\bship` would never match inside
  // `report_shipped`. The exact name this scan exists to catch. Splitting on them first
  // is what makes a tool name auditable by the same rule as a sentence.
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
    // `report_shipped` is the draft contract's one write tool. It is not this slice's,
    // and naming it here means it cannot arrive by accident. A later sprint that adds
    // it has to delete this assertion, which is a decision somebody makes rather than a
    // line somebody appends.
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

    // Non-vacuity: the scan catches the sentence it exists to catch. Without this the
    // whole check could pass on a broken regex.
    expect(mutationStemIn("Creates a fix and posts it to Slack.")).not.toBeNull();
    expect(mutationStemIn("report_shipped")).not.toBeNull();
  });
});

// Descriptions are read by a model

describe("tool descriptions", () => {
  test("no product jargon in any tool description", () => {
    expect(FORBIDDEN_PRODUCT_JARGON.length).toBeGreaterThan(0);

    for (const tool of MCP_TOOLS) {
      const text = `${tool.title} ${tool.description}`.toLowerCase();
      for (const word of FORBIDDEN_PRODUCT_JARGON) {
        expect(text).not.toContain(word);
      }
    }

    // The banned list is the product's, in full. A shortened copy here would make the
    // scan above pass by scanning for less.
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
      // Long enough to be a prompt rather than a label. A one-word description is the
      // practical failure here: the model never calls the tool at all.
      expect(tool.description.length).toBeGreaterThan(120);
      expect(tool.description.toLowerCase()).toContain("you");
    }

    // Each one says when, in its own words.
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

// The flagship: cross-tenant access is unexpressible

describe("tool inputs — the organization is never an argument", () => {
  /** Every spelling of "which tenant" this codebase uses or could plausibly grow. */
  const TENANT_KEY = /(^|[^a-z])(org|orgs|organization|organisation|tenant|workspace|account)/i;

  test("no tool input schema declares an organization key at any depth", () => {
    const keys = inputKeysOf();
    const offenders = keys.filter((key) => TENANT_KEY.test(key));

    // The whole point of the contract: a customer's coding agent cannot ask for another
    // tenant's work, because there is no argument in which to name one. The
    // organization comes from the authenticated credential and nowhere else, the same
    // rule `packages/db/__tests__/repositories/no-org-param.test.ts` enforces on
    // repository and service signatures, restated at the layer that is actually
    // reachable from outside this product.
    expect(offenders).toEqual([]);
  });

  test("no tool input schema names an actor either", () => {
    // Adjacent hazard, different dimension: an input naming a user would make one
    // member's view of shared, organization-scoped work depend on who was named in the
    // argument rather than on who is calling.
    const ACTOR_KEY = /(^|[^a-z])(user|member|actor|email|owner)/i;
    expect(inputKeysOf().filter((key) => ACTOR_KEY.test(key))).toEqual([]);
  });

  test("the key walk reaches the keys it claims to check", () => {
    // Anti-vacuity. Without this, a walk that silently collected nothing would make
    // both invariants above pass while auditing an empty list. The single most likely
    // way this file goes green while guaranteeing nothing.
    const keys = inputKeysOf();
    expect(keys.toSorted()).toEqual(["findingId", "fixId", "limit", "projectId"]);
  });

  test("the key walk descends through optionals, defaults, arrays and readonly wrappers", () => {
    // The walk is only total if it unwraps. Proven against a schema built here rather
    // than against the tool inputs, so tightening a tool input can never quietly shrink
    // what this proves.
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
    // Zod strips unknown keys by default. Belt and braces on the assertions above: even
    // a client that sends `organizationId` gets a parsed input that does not carry it,
    // so nothing downstream can read one.
    const parsed = listOpenFixesInputSchema.parse({ organizationId: "org_someone_else", limit: 5 });
    expect(Object.hasOwn(parsed, "organizationId")).toBe(false);
    expect(parsed.limit).toBe(5);
  });
});

// The list bound

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
    // The default IS the maximum, so the first call every agent makes cannot pull an
    // organization's whole history, and `limit` can only ask for fewer.
    const parsed = listOpenFixesInputSchema.parse({});
    expect(parsed.limit).toBe(LIST_OPEN_FIXES_DEFAULT_ITEMS);
    expect(LIST_OPEN_FIXES_DEFAULT_ITEMS).toBe(LIST_OPEN_FIXES_MAX_ITEMS);
  });

  test("the response array is bounded independently of the request", () => {
    // A server that ignores `limit` still cannot emit a longer list: the ceiling is on
    // the shape, not on the query that filled it.
    expect(listOpenFixesOutputSchema.safeParse(fixList(LIST_OPEN_FIXES_MAX_ITEMS)).success).toBe(
      true,
    );
    expect(
      listOpenFixesOutputSchema.safeParse(fixList(LIST_OPEN_FIXES_MAX_ITEMS + 1)).success,
    ).toBe(false);
  });

  test("a truncated list must say it was cut short", () => {
    // Fail direction: the agent must never infer "that is all of them" from a short
    // array. A producer that trims the list and forgets the flag leaves it confidently
    // wrong about the size of the work.
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
    // Work that has already landed must never come back as work to do. The status
    // literal makes that a property of the shape rather than of the query, so a
    // forgotten filter fails to parse instead of sending an agent to redo something.
    for (const status of ["awaiting_verification", "verified", "withdrawn"]) {
      const wrong = { ...openFix("fix_1"), status };
      expect(openFixSummarySchema.safeParse(wrong).success).toBe(false);
    }
    expect(openFixSummarySchema.safeParse(openFix("fix_1")).success).toBe(true);
  });
});

// Nothing found is an answer

describe("empty and zero are well-formed answers", () => {
  test("an empty list of open fixes is a valid response, not an error", () => {
    // The first thing a brand-new installation returns, and the thing the onboarding
    // step asserts: "list_open_fixes returns empty-but-valid".
    const parsed = listOpenFixesOutputSchema.safeParse({
      fixes: [],
      window: { returned: 0, totalOpen: 0, truncated: false },
    });
    expect(parsed.success).toBe(true);
  });

  test("a count where every session was set aside parses, with a zero denominator", () => {
    // : "we looked and everything in the window was set aside" is a real,
    // reportable state with a zero denominator, not an error, and not the same answer
    // as "there was nothing to look at".
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

// Counts carry their denominators

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
    // Identity stitching does not exist in this product, so "3 of 40" means 3 of 40
    // sessions. An agent must be unable to tell a founder otherwise, and the literal is
    // what makes that unable rather than unlikely.
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

// Every response carries both ids

describe("every response carries both ids", () => {
  test("a fix summary, a fix envelope and a finding all name their fix and their finding", () => {
    // An agent working across several turns loses the thread otherwise, and a fix
    // applied to the wrong finding is worse than no fix.
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
    // `null` is a fact ("nobody has asked for this to be fixed"). An absent key would
    // be indistinguishable from a lookup nobody bothered to do.
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

// get_fix, the envelope around the spec

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
    // An agent told it has three attempts plans differently from one that finds out by
    // running out.
    expect(fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, attemptsAllowed: 5 }).success).toBe(
      false,
    );
  });

  test("the results date is always stated as final", () => {
    // The date does not move. Post-hoc goalposts are forbidden, and the cheapest place
    // to enforce that is in the artefact the agent reads.
    expect(fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, dateIsFinal: false }).success).toBe(
      false,
    );
  });

  test("a fix envelope carries the spec as sentences, and refuses an empty one", () => {
    expect(fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, specText: "" }).success).toBe(false);
  });

  test("an envelope for a withdrawn or verified fix still parses", () => {
    // `get_fix` must be able to answer honestly about work that is closed. "this one
    // closed, nothing is needed" is the answer that stops an agent redoing it. Only the
    // list is restricted to open work.
    for (const status of ["awaiting_verification", "verified", "withdrawn"]) {
      expect(fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, status }).success).toBe(true);
    }
    expect(fixSpecEnvelopeSchema.safeParse({ ...FIX_ENVELOPE, status: "in_review" }).success).toBe(
      false,
    );
  });
});

// get_finding, evidence or nothing

describe("the finding response", () => {
  test("a finding with no evidence is refused", () => {
    // Fail direction: refuse to serve a claim with no way to check it. A coding agent
    // is about to spend a customer's tokens on whatever this says, and unevidenced
    // claims burn trust faster than silence.
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
    // An agent given a wrong path edits the wrong file with total confidence.
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
