import { z } from "zod";

export const RENDERED_MESSAGE_VERSION = 1;

const renderedActionSchema = z.object({
  actionId: z.string().min(1),
  label: z.string().min(1),
  value: z.string().min(1),
  style: z.literal("primary").nullable(),
});

export const renderedBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("section"), text: z.string() }),
  z.object({ kind: z.literal("context"), text: z.string() }),
  z.object({
    kind: z.literal("actions"),
    blockId: z.string().min(1),
    actions: z.array(renderedActionSchema),
  }),
]);

// Growthmind's own message model, not Block Kit: Block Kit is Slack's wire format, and a
// second reader of the same message is not Slack.
export const renderedMessageSchema = z.object({
  version: z.literal(RENDERED_MESSAGE_VERSION),
  blocks: z.array(renderedBlockSchema).min(1),
  text: z.string().min(1),
  legibility: z.object({
    characters: z.number().int().nonnegative(),
    lines: z.number().int().positive(),
  }),
});

export type RenderedBlock = z.infer<typeof renderedBlockSchema>;
export type RenderedMessage = z.infer<typeof renderedMessageSchema>;

// Null means "we do not hold what was sent" — a different answer from "nothing was sent",
// and never one to fill in by re-rendering.
export function parseRenderedMessage(value: unknown): RenderedMessage | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = renderedMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
