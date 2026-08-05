// The HTTP refusal sentences for first-run routes. Not the onboarding copy home.

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

export const SITE_DOMAIN_UNREADABLE: FirstRunGateRefusal = Object.freeze({
  code: "site_domain_unreadable",
  message:
    "That does not look like a website address. Give us the domain on its own, like " +
    "growthmind.ai, and we will read what is on it.",
  status: 400,
});

export const BELIEF_NOT_ADMITTED: FirstRunGateRefusal = Object.freeze({
  code: "belief_not_admitted",
  message:
    "Describe a group of people rather than one person — a role, a kind of company, a " +
    "situation. We keep this about segments on purpose.",
  status: 400,
});

export const BELIEF_NOT_FOUND: FirstRunGateRefusal = Object.freeze({
  code: "belief_not_found",
  message:
    "That line has changed since this page loaded, so nothing was altered. Reload and have " +
    "another look.",
  status: 409,
});

export const NO_CHANNEL_CONNECTED: FirstRunGateRefusal = Object.freeze({
  code: "no_channel_connected",
  message:
    "There is no channel connected yet, so there was nowhere to send a message. Connect Slack " +
    "first, then try the test message.",
  status: 409,
});

// Distinct from `NO_CHANNEL_CONNECTED` (AD-4): the workspace IS attached and
// only the address is missing, so "connect Slack first" would be false.
export const NO_CHANNEL_CHOSEN: FirstRunGateRefusal = Object.freeze({
  code: "no_channel_chosen",
  message:
    "Slack is connected, but no channel has been chosen yet, so there was nowhere to send a " +
    "message. Choose a channel, then try the test message.",
  status: 409,
});

export const CHANNEL_UNAVAILABLE: FirstRunGateRefusal = Object.freeze({
  code: "channel_unavailable",
  message:
    "We could not open this workspace's connection to Slack, so nothing was sent. Reconnect " +
    "Slack and try again.",
  status: 503,
});

// Names the variables because an operator, not the founder, is the one who can
// fix this — and never a 302 into a consent screen built with no client id.
export const SLACK_APP_UNAVAILABLE: FirstRunGateRefusal = Object.freeze({
  code: "slack_app_unavailable",
  message:
    "This installation has no Slack app of its own, so there is nothing to send you to yet. " +
    "Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET, restart, then try again — or paste a bot " +
    "token instead.",
  status: 503,
});

// Never an empty list: `[]` reads as "your workspace has no channels", which
// sends a founder off to create one they already have.
export const NO_WORKSPACE_CONNECTED: FirstRunGateRefusal = Object.freeze({
  code: "no_workspace_connected",
  message:
    "No Slack workspace is connected yet, so there are no channels to choose from. Connect " +
    "Slack first, then pick a channel.",
  status: 409,
});

export const CHANNELS_UNAVAILABLE: FirstRunGateRefusal = Object.freeze({
  code: "channels_unavailable",
  message:
    "We could not open this workspace's connection to Slack, so we could not read its " +
    "channels. Reconnect Slack and try again.",
  status: 503,
});

// Separate from `CHANNELS_CALL_FAILED` because the next actions differ: here a
// human has to reconnect, and pressing the button again achieves nothing.
export const CHANNELS_NOT_AUTHORISED: FirstRunGateRefusal = Object.freeze({
  code: "channels_not_authorised",
  message:
    "Slack would not let us read this workspace's channels. Someone has to reconnect Slack — " +
    "trying again will not help.",
  status: 502,
});

// Slack is up and did not serve this one call — pressing the button again is
// the right move.
export const CHANNELS_CALL_FAILED: FirstRunGateRefusal = Object.freeze({
  code: "channels_call_failed",
  message: "We could not reach Slack to read this workspace's channels. Try again.",
  status: 502,
});

// The route proves membership of the live list; the schema declines to guess
// Slack's id format. The cause is a stale picker, not an attacker.
export const CHANNEL_NOT_LISTED: FirstRunGateRefusal = Object.freeze({
  code: "channel_not_listed",
  message:
    "That channel is not one we can post in any more, so nothing was changed. Pick one from " +
    "the list on this screen.",
  status: 409,
});

// `attachChannel` fills an empty address and never moves a chosen one. Moving is the
// settings route's job, because only that one stamps the cutover a move needs (D12) — so
// this names the stored channel AND the place the move is done.
export function channelAlreadyChosen(label: string): FirstRunGateRefusal {
  return Object.freeze({
    code: "channel_already_chosen",
    message:
      `This workspace already sends what we find to #${label}, so nothing was changed. To ` +
      `send them somewhere else, change the channel on the settings page.`,
    status: 409,
  });
}

// The move's own refusal: there is a workspace and an address, and the write still lost.
// Only reachable as a race with another member moving the same row (D6).
export const CHANNEL_MOVE_LOST: FirstRunGateRefusal = Object.freeze({
  code: "channel_move_lost",
  message:
    "Somebody else changed this channel while you were choosing, so nothing was changed. " +
    "Reload the page to see where findings go now.",
  status: 409,
});

// Names the offending keys via `issue.keys`: "something was wrong" is unfixable.
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
