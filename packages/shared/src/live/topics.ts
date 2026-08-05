import { z } from "zod";

// One Postgres channel for every process. Per-organization channels would mean issuing
// LISTEN and UNLISTEN as people connect and disconnect, against a connection shared by every
// request on the process; one channel with the organization in the payload is a filter the
// web process applies itself, which is testable and cannot leak by forgetting an UNLISTEN.
export const LIVE_CHANNEL = "growthmind_live";

// What changed, never what it changed to. The browser answers by re-rendering from the
// database, so a payload carrying data would be a second copy of the truth — and NOTIFY caps
// its payload at 8000 bytes, which no rule could keep a real one under.
export const LIVE_TOPICS = [
  "business_context",
  "agent_connection",
  "first_run",
  "findings",
] as const;

export type LiveTopic = (typeof LIVE_TOPICS)[number];

export const liveTopicSchema = z.enum(LIVE_TOPICS);

export const livePayloadSchema = z.object({
  organizationId: z.string().min(1).max(128),
  topic: liveTopicSchema,
});

export type LivePayload = z.infer<typeof livePayloadSchema>;

export const LIVE_STREAM_PATH = "/api/live";

// The event name the route writes and the browser listens for.
export const LIVE_EVENT_NAME = "change";

// A comment on an already-open stream, so a proxy between us and the browser does not close
// an idle connection. Not a poll: nothing is requested and nothing is fetched.
export const LIVE_KEEPALIVE_MS = 25_000;
