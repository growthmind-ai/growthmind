// READING SLACK'S ANSWERS AS EXTERNAL DATA — the one place a Slack HTTP response
// becomes a shape this repository is willing to believe.
//
// Why this module exists at all, and why it is HERE rather than in `apps/web`
//
// `apps/web` declares no `zod` dependency, and two tests pin that absence
// (`apps/web/__tests__/mcp/no-direct-zod.test.ts` WIRE-Z1, and the manifest walk in
// `__tests__/undeclared-dependencies.test.ts`). The stated reason is not an
// `instanceof` hazard — that was measured and withdrawn — but ownership: one package
// owns the schemas, so a producer and a consumer can never drift apart across a wire
// nobody is looking at. The OAuth callback and the channel picker both live in
// `apps/web`, both read a Slack envelope, and both need that envelope validated rather
// than trusted (D5). So the validation lives in the package that already owns every
// other vendor boundary in this repository, and `apps/web` imports two functions that
// return plain TypeScript.
//
// What "validated rather than trusted" buys, concretely
//
// Slack answers `oauth.v2.access` and `conversations.list` with HTTP 200 and
// `{"ok":false,"error":"…"}` — the status says the call was served, the body says the
// thing did not happen. Every parser below therefore reports the ENVELOPE's verdict,
// never the transport's, and returns `null` for a body it cannot classify at all (a
// proxy's HTML page, an empty body, a JSON array). `null` is not "no", it is "we do
// not know", and the callers map the two to different outcomes.
//
// Nothing here reads a credential into a message. `SlackEnvelope`'s failure arm carries
// Slack's own `error` STRING because the caller needs it to select a code — and every
// caller consumes it with a lookup, never by interpolation. That is the same shape
// `./errors.ts` documents as the redaction guarantee.
import { z } from "zod";

import { MAX_RESPONSE_BYTES } from "./constants";

/**
 * Reads a response body without ever throwing across this boundary.
 *
 * Returns `null` for anything unreadable, which every caller then maps to its own
 * "the call did not complete" code.
 *
 * DELIBERATELY SIMPLER THAN `../posthog/read-json-body.ts`, and the difference is the
 * threat model rather than an oversight. That reader walks pages whose urls the remote
 * supplies, so it must assume a hostile body and count bytes as it streams. Every url
 * here is a compile-time constant naming one Slack endpoint (`./constants.ts`), the
 * replies are small, and the declared-length check plus a post-read cap covers the only
 * realistic case: a proxy or captive portal answering with a page.
 *
 * It lives in this module rather than inside `./poster.ts` for the reason
 * `../posthog/read-json-body.ts` was lifted out of `../posthog/client.ts`: it now has
 * three consumers (the poster, the OAuth exchange, the channel list), and a copied
 * reader drifts — the copy that drifts being the one nobody is looking at the day the
 * other end starts misbehaving.
 */
export async function readSlackJsonBody(response: Response): Promise<unknown> {
  try {
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      return null;
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      return null;
    }

    // Annotated rather than asserted: `JSON.parse` returns `any`, and widening it to
    // `unknown` at the binding keeps that `any` from escaping this function without a
    // cast.
    const decoded: unknown = JSON.parse(text);
    return decoded;
  } catch {
    return null;
  }
}

/**
 * What Slack said, once the transport has been set aside.
 *
 * Three outcomes, not two, and the third is the one that gets forgotten: a parser
 * returns `SlackEnvelope | null`, where `null` means the body was not a Slack envelope
 * at all. Collapsing that into the `ok: false` arm would let a captive portal's login
 * page be reported to a founder as "Slack refused", which sends them to fix a Slack
 * problem they do not have.
 */
export type SlackEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string | undefined };

/**
 * The envelope every Slack Web API method shares, and the only thing read before the
 * method-specific parse below.
 *
 * `error` is optional because a `{ok:false}` body carrying no `error` is a real shape
 * (a rewritten body, a truncation), and it must land somewhere named rather than crash
 * a caller. Unknown keys are stripped: these methods echo back far more than three
 * fields and this package has no business holding any of it.
 */
const slackEnvelopeSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

// ===========================================================================
// oauth.v2.access — the workspace grant
// ===========================================================================

/**
 * One completed Slack install, reduced to the three facts the connection row needs.
 *
 * `teamName` IS `string | undefined`, DELIBERATELY. Slack documents `team.name` on
 * every successful grant and sends it in practice, but refusing an otherwise valid
 * install over a missing DISPLAY NAME would trade the credential — the thing the whole
 * round trip exists to obtain — for a label. So an absent name degrades to `undefined`
 * and the connection is still made; `InsertActiveSlackConnectionInput.workspaceName` is
 * already optional for the same reason. The name is what a sentence renders, not what a
 * delivery depends on.
 */
export interface SlackWorkspaceGrant {
  readonly accessToken: string;
  readonly teamId: string;
  readonly teamName: string | undefined;
}

/**
 * The success arm's required shape. `access_token` and `team.id` are load-bearing —
 * without either there is no connection to store — so both are `min(1)` and a body
 * missing them parses as `null` rather than as a grant with an empty token.
 */
const slackOAuthAccessSchema = z.object({
  access_token: z.string().min(1),
  team: z.object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
  }),
});

/**
 * Parses an `oauth.v2.access` reply.
 *
 * `null` means the body was not a Slack envelope, or claimed success while omitting the
 * token or the team id — both of which are "we do not know what happened", never "the
 * install succeeded".
 */
export function parseSlackOAuthAccess(body: unknown): SlackEnvelope<SlackWorkspaceGrant> | null {
  const envelope = slackEnvelopeSchema.safeParse(body);
  if (!envelope.success) return null;
  if (!envelope.data.ok) return { ok: false, error: envelope.data.error };

  const grant = slackOAuthAccessSchema.safeParse(body);
  if (!grant.success) return null;

  return {
    ok: true,
    value: {
      accessToken: grant.data.access_token,
      teamId: grant.data.team.id,
      teamName: grant.data.team.name,
    },
  };
}

// ===========================================================================
// conversations.list — the channels a founder can pick from
// ===========================================================================

/**
 * One channel, as much as Slack was willing to say about it.
 *
 * The three booleans are `boolean | null` rather than `boolean` because Slack sets them
 * per conversation type and a caller that read an absent flag as `false` would be
 * asserting something the vendor never said. `null` is "not stated", and the ordering
 * policy that consumes these treats it as such.
 */
export interface SlackConversation {
  readonly id: string;
  readonly name: string;
  readonly isArchived: boolean | null;
  readonly isPrivate: boolean | null;
  readonly isMember: boolean | null;
}

/** One page of the cursor walk. `nextCursor` is `null` when Slack says this is the last
 *  page — which it signals with an EMPTY STRING, not by omitting the field. */
export interface SlackConversationsPage {
  readonly conversations: readonly SlackConversation[];
  readonly nextCursor: string | null;
}

/**
 * One list item.
 *
 * `id` and `name` are required: a picker row with no label cannot be rendered and a row
 * with no id cannot be attached. Everything else is optional, because
 * `conversations.list` returns several conversation types and only some of them carry
 * each flag.
 */
const slackConversationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  is_archived: z.boolean().optional(),
  is_private: z.boolean().optional(),
  is_member: z.boolean().optional(),
});

/**
 * `channels` is `unknown[]` ON PURPOSE.
 *
 * Parsing the array with `z.array(slackConversationSchema)` would discard THE WHOLE
 * PAGE the first time one item arrived in a shape we did not expect — an im, an mpim, a
 * conversation type Slack adds next year — and the founder would be told their
 * workspace has no channels while looking at a workspace full of them. Items are parsed
 * one at a time below and the ones that parse are kept (D5: sparse input degrades, it
 * does not erase).
 */
const slackConversationsSchema = z.object({
  channels: z.array(z.unknown()),
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
});

/**
 * Parses one `conversations.list` page.
 *
 * `null` means the body was not a Slack envelope, or claimed success with no `channels`
 * array at all. An EMPTY `channels` array is a legitimate answer and parses as an empty
 * page — what a caller does with that (never "your workspace has no channels" when the
 * real problem is a missing connection) is the caller's decision, not this parser's.
 */
export function parseSlackConversationsPage(
  body: unknown,
): SlackEnvelope<SlackConversationsPage> | null {
  const envelope = slackEnvelopeSchema.safeParse(body);
  if (!envelope.success) return null;
  if (!envelope.data.ok) return { ok: false, error: envelope.data.error };

  const page = slackConversationsSchema.safeParse(body);
  if (!page.success) return null;

  const conversations: SlackConversation[] = [];
  for (const item of page.data.channels) {
    const parsed = slackConversationSchema.safeParse(item);
    if (!parsed.success) continue;

    conversations.push({
      id: parsed.data.id,
      name: parsed.data.name,
      isArchived: parsed.data.is_archived ?? null,
      isPrivate: parsed.data.is_private ?? null,
      isMember: parsed.data.is_member ?? null,
    });
  }

  // Slack ends the walk with `next_cursor: ""`, not by omitting it. Reading the empty
  // string as a cursor would re-request page one forever, which is exactly the
  // unbounded loop the caller's page cap exists to make impossible.
  const rawCursor = page.data.response_metadata?.next_cursor ?? "";

  return {
    ok: true,
    value: { conversations, nextCursor: rawCursor.length > 0 ? rawCursor : null },
  };
}
