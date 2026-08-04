export type McpRefusalCode =
  | "unauthenticated"
  | "browser_origin"
  | "wrong_content_type"
  | "wrong_method"
  | "body_too_large"
  | "malformed_request"
  | "unknown_tool"
  | "not_found"
  | "unavailable"
  | "ambiguous_project";

export interface McpRefusal {
  readonly code: McpRefusalCode;

  readonly message: string;
  readonly status: number;
}

export const UNAUTHENTICATED: McpRefusal = Object.freeze({
  code: "unauthenticated",
  message:
    "This request did not arrive with a key this server reads, so nothing was looked at. " +
    "The key a website sends its activity with is not the same key a coding agent reads with — " +
    "ask whoever runs this product for one made for coding agents.",
  status: 401,
});

export const NOT_FOUND: McpRefusal = Object.freeze({
  code: "not_found",
  message:
    "There is nothing here with that id. Call list_open_fixes to see the ids you can ask about.",
  status: 404,
});

export const UNAVAILABLE: McpRefusal = Object.freeze({
  code: "unavailable",
  message:
    "Something went wrong on our side while putting that answer together, so nothing is coming " +
    "back rather than something wrong. Nothing you change will fix it; try again later.",
  status: 500,
});

export const BROWSER_ORIGIN: McpRefusal = Object.freeze({
  code: "browser_origin",
  message:
    "This server does not answer requests from a web page. Call it from a coding agent or " +
    "another program, with the key that agent was given.",
  status: 403,
});

export const WRONG_CONTENT_TYPE: McpRefusal = Object.freeze({
  code: "wrong_content_type",
  message:
    "We could not read that request because it did not arrive as JSON. Send it with a content " +
    "type of application/json.",
  status: 415,
});

export const WRONG_METHOD: McpRefusal = Object.freeze({
  code: "wrong_method",
  message:
    "This server only reads, and it only answers a POST carrying a single JSON-RPC message. " +
    "Send tools/list that way to see what it can do. Nothing here changes anything.",
  status: 405,
});

export const BODY_TOO_LARGE: McpRefusal = Object.freeze({
  code: "body_too_large",
  message:
    "That request was too big to read, so none of it was looked at. This server only ever needs " +
    "a short message — a method name and at most a couple of ids — so send one under a megabyte.",
  status: 413,
});

export const MALFORMED_BODY: McpRefusal = Object.freeze({
  code: "malformed_request",
  message:
    "We could not read that request. Send a single JSON-RPC message: put the method you want " +
    "in a method field — tools/list to see what this server can do, or tools/call with the " +
    "tool's name and its arguments in a params field.",
  status: 400,
});

export function unknownTool(message: string): McpRefusal {
  return { code: "unknown_tool", message, status: 400 };
}

export const NO_PROJECT: McpRefusal = Object.freeze({
  code: "not_found",
  message:
    "There is nothing set up here to know anything about yet. Carry on with the work you were " +
    "going to do; this answer is not a reason to stop.",
  status: 404,
});

// Errors instruct. Naming the ids is what turns a refusal into the caller's next call.
export function ambiguousProject(projectIds: readonly string[]): McpRefusal {
  return {
    code: "ambiguous_project",
    message:
      `There is more than one product set up here, so say which one you mean and ask again. ` +
      `Pass one of these as projectId: ${projectIds.join(", ")}.`,
    status: 400,
  };
}

export interface McpParseIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

export function malformedInput(tool: string, issues: readonly McpParseIssue[]): McpRefusal {
  const reasons = issues.map(describeIssue).join("; ");
  return {
    code: "malformed_request",
    message:
      reasons.length > 0
        ? `Some of what you sent does not fit ${tool}: ${reasons}.`
        : `Some of what you sent does not fit ${tool}.`,
    status: 400,
  };
}

function describeIssue(issue: McpParseIssue): string {
  const where = issue.path.map((segment) => String(segment)).join(".");
  return where.length > 0 ? `${where} — ${issue.message}` : issue.message;
}

export function refusalResponse(refusal: McpRefusal): Response {
  return Response.json(
    { ok: false, error: { code: refusal.code, message: refusal.message } },
    { status: refusal.status },
  );
}

export interface McpTextContent {
  readonly type: "text";
  readonly text: string;
}

export interface McpToolErrorResult {
  readonly content: McpTextContent[];
  readonly isError: true;
}

export function refusalToolResult(refusal: McpRefusal): McpToolErrorResult {
  return { content: [{ type: "text", text: refusal.message }], isError: true };
}
