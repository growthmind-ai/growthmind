import { z } from "zod";

export const slackInteractionActionSchema = z.object({
  action_id: z.string().min(1),
  block_id: z.string().min(1).optional(),
  value: z.string().optional(),
  type: z.string().min(1),
});
export type SlackInteractionAction = z.infer<typeof slackInteractionActionSchema>;

export const slackInteractionPayloadSchema = z.object({
  type: z.literal("block_actions"),
  team: z.object({ id: z.string().min(1) }).optional(),
  user: z.object({ id: z.string().min(1) }).optional(),
  channel: z.object({ id: z.string().min(1) }),
  container: z.object({
    channel_id: z.string().min(1).optional(),
    message_ts: z.string().min(1),
  }),
  response_url: z.string().min(1),
  actions: z.array(slackInteractionActionSchema).min(1),
});
export type SlackInteractionPayload = z.infer<typeof slackInteractionPayloadSchema>;
