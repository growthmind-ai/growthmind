import type { DeliveryPoster, PostRequest, PostResult } from "@growthmind/shared";
import { z } from "zod";

import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, SLACK_POST_MESSAGE_URL } from "./constants";
import type { SlackPosterConfig, SlackPosterDeps } from "./deps";
import { mapSlackError, postFailure } from "./errors";

const slackPostMessageResponseSchema = z.object({
  ok: z.boolean(),
  ts: z.string().optional(),
  error: z.string().optional(),
});

async function readJsonBody(response: Response): Promise<unknown> {
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

        const parsed = slackPostMessageResponseSchema.safeParse(await readJsonBody(response));
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
