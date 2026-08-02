import { z } from "zod";

export const postFailureCodeSchema = z.enum([
  "call_failed",

  "rejected",

  "not_authorised",

  "channel_unavailable",
]);
export type PostFailureCode = z.infer<typeof postFailureCodeSchema>;

export function isRetryablePostFailure(code: PostFailureCode): boolean {
  return code === "call_failed";
}

export const postResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    messageRef: z.string().min(1),
  }),
  z.object({
    ok: z.literal(false),
    code: postFailureCodeSchema,
    message: z.string().min(1),
  }),
]);
export type PostResult = z.infer<typeof postResultSchema>;

export type PostRequest = {
  readonly channelId: string;

  readonly blocks: readonly unknown[];

  readonly fallbackText: string;
};

export type DeliveryPoster = {
  post(request: PostRequest): Promise<PostResult>;
};
