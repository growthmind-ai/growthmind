export interface ParseIssueLike {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly keys?: readonly string[] | undefined;
}

export interface ParseErrorLike {
  readonly issues: readonly ParseIssueLike[];
}

export interface FirstRunRefusal {
  readonly code: "unrecognized_keys" | "invalid_body";
  readonly message: string;
  readonly status: 400;
}

export interface FirstRunGateRefusal {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

export const SIGNED_OUT: FirstRunGateRefusal = Object.freeze({
  code: "signed_out",
  message: "You are not signed in, so nothing was looked at. Sign in and open this page again.",
  status: 401,
});

export const SECOND_CHANNEL: FirstRunGateRefusal = Object.freeze({
  code: "second_channel",
  message:
    "This workspace already sends what we find to a channel. Disconnect that one first, then " +
    "connect this one.",
  status: 409,
});

export const NO_CHANNEL_CONNECTED: FirstRunGateRefusal = Object.freeze({
  code: "no_channel_connected",
  message:
    "There is no channel connected yet, so there was nowhere to send a message. Connect Slack " +
    "first, then try the test message.",
  status: 409,
});

export const CHANNEL_UNAVAILABLE: FirstRunGateRefusal = Object.freeze({
  code: "channel_unavailable",
  message:
    "We could not open this workspace's connection to Slack, so nothing was sent. Reconnect " +
    "Slack and try again.",
  status: 503,
});

function unrecognizedKeysMessage(names: readonly string[]): string {
  const listed = names.length > 0 ? names.join(", ") : "something we do not read";
  return (
    `Some of what you sent is not ours to read: ${listed}. Take it out and send it again — ` +
    `this screen never asks you to name a project or a workspace, because both come from the ` +
    `account you are signed in to.`
  );
}

const INVALID_BODY_MESSAGE =
  "We could not read what you sent. Send it as a JSON object with the fields this step asks " +
  "for — and when a step asks for nothing, an empty one.";

function unrecognizedKeysOf(issue: ParseIssueLike): readonly string[] {
  const keys: unknown = issue.keys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
}

export function describeBodyRefusal(error: ParseErrorLike): FirstRunRefusal {
  const names = [
    ...new Set(
      error.issues
        .filter((issue) => issue.code === "unrecognized_keys")
        .flatMap((issue) => unrecognizedKeysOf(issue)),
    ),
  ];

  if (names.length > 0) {
    return { code: "unrecognized_keys", message: unrecognizedKeysMessage(names), status: 400 };
  }

  return { code: "invalid_body", message: INVALID_BODY_MESSAGE, status: 400 };
}

export function refusalResponse(refusal: FirstRunRefusal | FirstRunGateRefusal): Response {
  return Response.json(
    { error: { code: refusal.code, message: refusal.message } },
    { status: refusal.status },
  );
}
