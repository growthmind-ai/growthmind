import { z } from "zod";

import { MAX_RESPONSE_BYTES } from "./constants";

// Bounded read, never throwing across this boundary: declared length checked first, then
// the decoded text capped. Anything unreadable is `null`, which callers map to their own
// "the call did not complete" code — never to "Slack refused".
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

    const decoded: unknown = JSON.parse(text);
    return decoded;
  } catch {
    return null;
  }
}

// Three outcomes, not two: `null` from a parser means the body was not a Slack envelope
// at all, which must never be reported to a founder as "Slack refused".
export type SlackEnvelope<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string | undefined };

const slackEnvelopeSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
});

// `teamName` is optional DELIBERATELY: refusing an otherwise valid install over a missing
// display name would trade the credential for a label.
export interface SlackWorkspaceGrant {
  readonly accessToken: string;
  readonly teamId: string;
  readonly teamName: string | undefined;
}

const slackOAuthAccessSchema = z.object({
  access_token: z.string().min(1),
  team: z.object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
  }),
});

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

// The three booleans are `boolean | null`: Slack sets them per conversation type, and
// reading an absent flag as `false` would assert something the vendor never said.
export interface SlackConversation {
  readonly id: string;
  readonly name: string;
  readonly isArchived: boolean | null;
  readonly isPrivate: boolean | null;
  readonly isMember: boolean | null;
}

// `nextCursor` is `null` on the last page — which Slack signals with an EMPTY STRING,
// not by omitting the field.
export interface SlackConversationsPage {
  readonly conversations: readonly SlackConversation[];
  readonly nextCursor: string | null;
}

const slackConversationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  is_archived: z.boolean().optional(),
  is_private: z.boolean().optional(),
  is_member: z.boolean().optional(),
});

// `channels` is `unknown[]` ON PURPOSE: `z.array(slackConversationSchema)` would discard
// the WHOLE page over one unexpected item. Items are parsed one at a time below.
const slackConversationsSchema = z.object({
  channels: z.array(z.unknown()),
  response_metadata: z.object({ next_cursor: z.string().optional() }).optional(),
});

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

  const rawCursor = page.data.response_metadata?.next_cursor ?? "";

  return {
    ok: true,
    value: { conversations, nextCursor: rawCursor.length > 0 ? rawCursor : null },
  };
}
