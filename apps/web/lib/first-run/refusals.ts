// WHAT THE ONBOARDING ROUTES SAY WHEN THEY WILL NOT ANSWER (O-008, AD-16,
// AD-16a).
//
// ###########################################################################
// # THIS FILE MIRRORS `apps/web/lib/mcp/refusals.ts` FIELD FOR FIELD, AND
// # THAT IS THE DECISION RATHER THAN A COINCIDENCE.
// #
// # That module is the one shipped refusal shape in this app: a frozen
// # `{ code, message, status }` constant, one producer for the wire form, and
// # plain English addressed to the reader with no product vocabulary. AD-16
// # requires every 400 here to carry "a sentence from our table and never a
// # raw Zod message", which is the same obligation one surface over. So this
// # copies the precedent instead of inventing a second vocabulary for the
// # same job.
// #
// # THE SENTENCES LIVE HERE, NOT IN `packages/shared`, FOR THE SAME REASON
// # THE MCP ONES DO. `packages/shared/src/onboarding/messages.ts` is the one
// # home for the SURFACE's copy — the words a founder reads on the screen,
// # audited for durations, jargon and proper nouns. What is below is what an
// # HTTP boundary says to a caller that sent something it cannot read. A
// # refusal is not a step's helper text, and putting it in the audited copy
// # home would put an API vocabulary inside the product's voice.
// ###########################################################################
//
// ---------------------------------------------------------------------------
// AD-16a'S THREE MEASURED SHAPE TRAPS, AND WHY THE MAPPING KEYS OFF `code`
// ---------------------------------------------------------------------------
//
// Measured against the installed zod 4.4.3:
//
//   1. `issue.path` is `[]` on an `unrecognized_keys` issue — the offending
//      names live on `issue.keys`, and `flattenError()` puts the message in
//      `formErrors` with `fieldErrors: {}`. A helper written against `path`,
//      or one reading `fieldErrors`, produces an EMPTY, uninformative refusal.
//   2. N unknown keys collapse into ONE issue carrying an N-element `keys`
//      array. Never one issue per bad key.
//   3. A `null`, `undefined`, array, string or number body refuses as
//      `invalid_type`, NOT `unrecognized_keys` — and that is the ORDINARY
//      case, because it is what a parsed request body is when a client posts
//      something that is not an object. A mapping that keyed only off
//      `unrecognized_keys` would THROW on the very input it exists to refuse,
//      turning a 400 into a 500.
//
// So the mapping branches on `issue.code`, reads names off `issue.keys`, and
// has a total fallback. The onboarding `refusal-mapping.test.ts` suite drives
// all six body shapes through it and asserts that none of them throws.

/**
 * One parse issue, structurally.
 *
 * DECLARED HERE RATHER THAN IMPORTED FROM `zod`, exactly as `McpParseIssue`
 * is and for the same measured reason: this package declares no `zod`
 * dependency and WIRE-Z1 pins that absence. `keys` is optional because it
 * exists only on the `unrecognized_keys` variant — trap 1, restated as a type.
 */
export interface ParseIssueLike {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly keys?: readonly string[] | undefined;
}

export interface ParseErrorLike {
  readonly issues: readonly ParseIssueLike[];
}

/**
 * A body this surface refused, and why — in OUR words.
 *
 * `code` names which of the two SHAPES the refusal was, never which sentence
 * was rendered: a client branches on the code, a person reads the message, and
 * conflating the two is how a machine identifier ends up on a screen.
 *
 * The status is the literal `400` because every refusal here is one. An
 * unknown key is a client mistake, not a server fault, and never a 200 with
 * the value quietly dropped.
 */
export interface FirstRunRefusal {
  readonly code: "unrecognized_keys" | "invalid_body";
  readonly message: string;
  readonly status: 400;
}

/**
 * A refusal that is not about the body's shape. Kept separate from
 * `FirstRunRefusal` so the 400-only status above stays a literal type rather
 * than widening to `number` for the sake of one sibling.
 */
export interface FirstRunGateRefusal {
  readonly code: string;
  readonly message: string;
  readonly status: number;
}

/**
 * No session. **The only tenancy input this surface has is the session**, so
 * there is nothing to fall back to and nothing to serve.
 *
 * IT CARRIES NO DATA AND NAMES NO INTERNALS. The whole reconciled payload is
 * exactly what a signed-out caller must not receive, and a stack, a file path
 * or a line:column pair in a refusal body is a leak with a friendly face.
 */
export const SIGNED_OUT: FirstRunGateRefusal = Object.freeze({
  code: "signed_out",
  message: "You are not signed in, so nothing was looked at. Sign in and open this page again.",
  status: 401,
});

/**
 * A second live channel for one workspace.
 *
 * The partial unique index refuses it — never a prior read (EC-O6, D6) — so
 * two members connecting at the same moment cannot both win, and the loser
 * learns it from Postgres. THIS SENTENCE IS WHAT THE LOSER READS: plain
 * English, naming the one thing to do, with no error code and no constraint
 * name. A `23505` reaching a customer is a bug wearing a database's clothes.
 */
export const SECOND_CHANNEL: FirstRunGateRefusal = Object.freeze({
  code: "second_channel",
  message:
    "This workspace already sends what we find to a channel. Disconnect that one first, then " +
    "connect this one.",
  status: 409,
});

/** A test message asked for before anything was connected to send it to. */
export const NO_CHANNEL_CONNECTED: FirstRunGateRefusal = Object.freeze({
  code: "no_channel_connected",
  message:
    "There is no channel connected yet, so there was nowhere to send a message. Connect Slack " +
    "first, then try the test message.",
  status: 409,
});

/**
 * A test message asked for while the workspace is attached and no channel has
 * been chosen (AD-4).
 *
 * DISTINCT FROM `NO_CHANNEL_CONNECTED`, and the distinction is the whole reason
 * this constant exists. Connect-then-choose-later makes the mid-OAuth window
 * precisely when somebody presses "Send a test message": the row is there, the
 * token is real, `getActiveForOrg` returns it, and the only thing missing is the
 * address. Telling that founder to "connect Slack first" sends them back through
 * a consent screen they already completed and leaves them exactly where they
 * were. So this names the one remaining act — choose a channel — and says why
 * nothing was sent.
 *
 * 409 rather than 400: the request was fine, the organization's state is not
 * ready for it, which is the same reading `NO_CHANNEL_CONNECTED` and
 * `SECOND_CHANNEL` take.
 */
export const NO_CHANNEL_CHOSEN: FirstRunGateRefusal = Object.freeze({
  code: "no_channel_chosen",
  message:
    "Slack is connected, but no channel has been chosen yet, so there was nowhere to send a " +
    "message. Choose a channel, then try the test message.",
  status: 409,
});

/**
 * This installation cannot open a delivery channel at all.
 *
 * DISTINCT FROM "nothing is connected". One is a customer who has not finished
 * setting up; the other is an operator who has to change a value and restart.
 * Telling a founder to reconnect when the fault is ours sends them to do work
 * that cannot help.
 */
export const CHANNEL_UNAVAILABLE: FirstRunGateRefusal = Object.freeze({
  code: "channel_unavailable",
  message:
    "We could not open this workspace's connection to Slack, so nothing was sent. Reconnect " +
    "Slack and try again.",
  status: 503,
});

/**
 * "Add to Slack" pressed on an installation that has no Slack app of its own.
 *
 * AD-6 says the OAuth path does not RENDER at all without the pair, so reaching
 * this route in that state means the card was rendered from a stale payload or
 * the address was typed. Either way the answer must not be a redirect: a 302
 * into a consent screen built with no client id is a dead end wearing a working
 * feature's clothes, and the founder leaves the product to read Slack's error
 * page about an app that does not exist.
 *
 * IT NAMES THE VARIABLES because the person who can fix this is an operator,
 * not the founder — the same reading `CONNECT_REFUSAL_MESSAGES.misconfigured`
 * takes about the encryption key. Reusing that sentence here would point them
 * at the wrong variable entirely.
 */
export const SLACK_APP_UNAVAILABLE: FirstRunGateRefusal = Object.freeze({
  code: "slack_app_unavailable",
  message:
    "This installation has no Slack app of its own, so there is nothing to send you to yet. " +
    "Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET, restart, then try again — or paste a bot " +
    "token instead.",
  status: 503,
});

/**
 * A channel list asked for before any workspace was attached.
 *
 * NEVER AN EMPTY LIST. `[]` reads as "your workspace has no channels", which
 * sends a founder off to create one they already have — work that cannot help,
 * caused by us. Distinct from `NO_CHANNEL_CHOSEN`, which is the opposite half:
 * there the workspace IS attached and the address is what is missing.
 */
export const NO_WORKSPACE_CONNECTED: FirstRunGateRefusal = Object.freeze({
  code: "no_workspace_connected",
  message:
    "No Slack workspace is connected yet, so there are no channels to choose from. Connect " +
    "Slack first, then pick a channel.",
  status: 409,
});

/**
 * A stored connection this installation can no longer open.
 *
 * The sibling of `CHANNEL_UNAVAILABLE` for the listing path rather than the
 * posting one, and separate because the two say different things about what did
 * not happen. Telling a founder "nothing was sent" while they are looking at an
 * empty channel picker describes an act nobody attempted.
 */
export const CHANNELS_UNAVAILABLE: FirstRunGateRefusal = Object.freeze({
  code: "channels_unavailable",
  message:
    "We could not open this workspace's connection to Slack, so we could not read its " +
    "channels. Reconnect Slack and try again.",
  status: 503,
});

/**
 * Slack refused to list the workspace's channels.
 *
 * SEPARATE FROM `CHANNELS_CALL_FAILED` BECAUSE THE NEXT ACTIONS DIFFER, which
 * is the whole reason `listChannels` returns two codes rather than one. This is
 * the one where pressing the button again achieves nothing: the token is
 * refused, or the install was made without the scopes that read channels, and
 * a human has to reconnect the workspace.
 */
export const CHANNELS_NOT_AUTHORISED: FirstRunGateRefusal = Object.freeze({
  code: "channels_not_authorised",
  message:
    "Slack would not let us read this workspace's channels. Someone has to reconnect Slack — " +
    "trying again will not help.",
  status: 502,
});

/** Slack is up and did not serve this one call. Pressing the button again is
 *  the right move, which is why it never collapses into the refusal above. */
export const CHANNELS_CALL_FAILED: FirstRunGateRefusal = Object.freeze({
  code: "channels_call_failed",
  message: "We could not reach Slack to read this workspace's channels. Try again.",
  status: 502,
});

/**
 * A channel id that is not one of the ones we just offered.
 *
 * THE ROUTE PROVES MEMBERSHIP OF THE LIVE LIST, AND NOTHING ELSE COULD.
 * `firstRunSlackChannelInputSchema` deliberately declines to guess Slack's id
 * format — a regex that guessed wrong would refuse a real channel a founder
 * picked from our own list — and says in its own doc comment that the route
 * checks membership instead. This is that check's answer.
 *
 * The realistic cause is not an attacker: it is a picker left open while the
 * channel was archived or the bot was removed from it. So the sentence names
 * the ordinary next act rather than accusing anybody, and 409 rather than 400
 * says the request was fine and the world moved — the same reading
 * `NO_CHANNEL_CHOSEN` and `SECOND_CHANNEL` take.
 */
export const CHANNEL_NOT_LISTED: FirstRunGateRefusal = Object.freeze({
  code: "channel_not_listed",
  message:
    "That channel is not one we can post in any more, so nothing was changed. Pick one from " +
    "the list on this screen.",
  status: 409,
});

/**
 * The sentence for a body carrying something we do not read.
 *
 * IT NAMES THE OFFENDING KEYS, which is only reachable through `issue.keys`
 * (trap 1) — a customer told "something was wrong" cannot remove anything. And
 * it says WHY there is nothing to name: this surface takes the project and the
 * workspace from the session, so there is no id for a caller to supply.
 */
function unrecognizedKeysMessage(names: readonly string[]): string {
  const listed = names.length > 0 ? names.join(", ") : "something we do not read";
  return (
    `Some of what you sent is not ours to read: ${listed}. Take it out and send it again — ` +
    `this screen never asks you to name a project or a workspace, because both come from the ` +
    `account you are signed in to.`
  );
}

/**
 * The sentence for everything else, including the ordinary case (trap 3).
 *
 * DELIBERATELY NAMES NO FIELD PATH. Zod's paths are our own property names,
 * and echoing them at a customer is a machine identifier on a screen — the
 * thing `FINDING_CLASS_UNKNOWN_TEMPLATE` exists one package over to avoid. The
 * form is the thing that knows which box is empty.
 */
const INVALID_BODY_MESSAGE =
  "We could not read what you sent. Send it as a JSON object with the fields this step asks " +
  "for — and when a step asks for nothing, an empty one.";

/** The offending names off an `unrecognized_keys` issue. Trap 1, in one place:
 * zod 4.4.3 puts them on `issue.keys` and leaves `issue.path` as `[]`. */
function unrecognizedKeysOf(issue: ParseIssueLike): readonly string[] {
  const keys: unknown = issue.keys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
}

/**
 * A parse failure, as a sentence from our table and a 400.
 *
 * TOTAL BY CONSTRUCTION. Every path returns; nothing here can throw on a shape
 * it was not written for, because the only branch is on `issue.code` and the
 * fallback covers an empty issue list, an unknown code, and a body that was
 * never an object at all. That totality is the point: this function's whole
 * job is to turn a bad request into a message, and a crash inside it turns the
 * 400 it exists to produce into a 500.
 *
 * THE ZOD MESSAGE NEVER CROSSES. Not `issue.message`, not `flattenError`'s
 * `formErrors[0]`, not the code as prose — the same discipline
 * `connections.service.ts:154-165` applies to a vendor's error text, applied to
 * our own validator's.
 */
export function describeBodyRefusal(error: ParseErrorLike): FirstRunRefusal {
  // TRAP 2: N unknown keys collapse into ONE issue, so the names are gathered
  // across every issue rather than from the first one, and a body that manages
  // to produce two of them still names all of them once.
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

/**
 * The wire form of a refusal. ONE PRODUCER, so two refusals built from one
 * constant are identical by construction rather than by review — the key
 * order is this literal's, the status is the refusal's, and nothing else is
 * added.
 *
 * `error` rather than a bare `message` field: a client branches on
 * `error.code`, and a body whose shape differs between a 400 and a 401 forces
 * every caller to guess which one it got.
 */
export function refusalResponse(refusal: FirstRunRefusal | FirstRunGateRefusal): Response {
  return Response.json(
    { error: { code: refusal.code, message: refusal.message } },
    { status: refusal.status },
  );
}
