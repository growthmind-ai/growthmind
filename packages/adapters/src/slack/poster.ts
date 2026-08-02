import type { DeliveryPoster, PostRequest, PostResult } from "@growthmind/shared";
import { z } from "zod";

import { REQUEST_TIMEOUT_MS, SLACK_POST_MESSAGE_URL } from "./constants";
import type { SlackPosterConfig, SlackPosterDeps } from "./deps";
// Shared with the OAuth token exchange and the channel list; one implementation, three callers.
import { readSlackJsonBody } from "./envelopes";
import { mapSlackError, postFailure } from "./errors";

const slackPostMessageResponseSchema = z.object({
  ok: z.boolean(),
  ts: z.string().optional(),
  error: z.string().optional(),
});

// Config and deps stay separate arguments: the credential belongs to the customer's row,
// the effects belong to the process. The bot token never reaches a returned failure —
// every exit here goes through `postFailure`'s fixed sentences.
export function createSlackDeliveryPoster(
  config: SlackPosterConfig,
  deps: SlackPosterDeps,
): DeliveryPoster {
  const authorization = `Bearer ${config.botToken}`;

  return {
    async post(request: PostRequest): Promise<PostResult> {
      try {
        let body: string;
        try {
          body = JSON.stringify({
            channel: request.channelId,
            blocks: request.blocks,

            text: request.fallbackText,
          });
        } catch {
          return postFailure("rejected");
        }

        let response: Response;
        try {
          response = await deps.fetch(SLACK_POST_MESSAGE_URL, {
            method: "POST",
            headers: {
              authorization,
              "content-type": "application/json; charset=utf-8",
              accept: "application/json",
            },
            body,

            redirect: "manual",

            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        } catch {
          return postFailure("call_failed");
        }

        const parsed = slackPostMessageResponseSchema.safeParse(await readSlackJsonBody(response));
        if (!parsed.success) {
          return postFailure("call_failed");
        }
        const envelope = parsed.data;

        if (envelope.ok) {
          if (!response.ok) {
            return postFailure("call_failed");
          }

          const messageRef = envelope.ts ?? "";
          if (messageRef.length === 0) {
            return postFailure("call_failed");
          }

          return { ok: true, messageRef };
        }

        return postFailure(mapSlackError(envelope.error));
      } catch {
        return postFailure("call_failed");
      }
    },
  };
}
