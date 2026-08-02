import type { PostRequest } from "@growthmind/shared";

import type { SlackPosterConfig, SlackPosterDeps } from "../../src/slack/deps";

export const AD_SLACK_BOT_TOKEN = "xoxb-ad-fake-not-a-real-bot-token-000000000000";

export const AD_SLACK_CHANNEL_ID = "C0ADFAKECHANNEL";

export const AD_SLACK_CONFIG: SlackPosterConfig = { botToken: AD_SLACK_BOT_TOKEN };

export const AD_SLACK_TS = "1753900000.000100";

export const AD_SLACK_REQUEST: PostRequest = {
  channelId: AD_SLACK_CHANNEL_ID,
  blocks: [{ type: "section", text: { type: "mrkdwn", text: "ad-fake finding body" } }],
  fallbackText: "ad-fake finding body",
};

export interface RecordedSlackRequest {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | null;
  readonly contentType: string | null;

  readonly body: string | null;
}

export interface FakeSlackResponseSpec {
  readonly status?: number;

  readonly json?: unknown;

  readonly text?: string;
  readonly headers?: Record<string, string>;

  readonly networkError?: boolean;

  readonly timeout?: boolean;
}

export interface FakeSlackFetch {
  readonly fetch: SlackPosterDeps["fetch"];
  readonly requests: RecordedSlackRequest[];
}

export function createFakeSlackFetch(spec: FakeSlackResponseSpec): FakeSlackFetch {
  const requests: RecordedSlackRequest[] = [];

  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const sentBody = init?.body;
    requests.push({
      url,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
      body: typeof sentBody === "string" ? sentBody : null,
    });

    if (spec.networkError === true) {
      throw new TypeError("ad-fake slack transport fault: connection refused");
    }
    if (spec.timeout === true) {
      throw new DOMException("The operation timed out.", "TimeoutError");
    }

    const body = spec.text ?? (spec.json === undefined ? "" : JSON.stringify(spec.json));

    return new Response(body.length === 0 ? null : body, {
      status: spec.status ?? 200,
      headers: { "content-type": "application/json", ...spec.headers },
    });
  };

  return { fetch: Object.assign(handler, { preconnect: globalThis.fetch.preconnect }), requests };
}

export function createBrokenResponseFetch(broken: "headers" | "text"): SlackPosterDeps["fetch"] {
  const handler = async (): Promise<Response> => {
    const response = new Response('{"ok":true,"ts":"1753900000.000100"}', { status: 200 });
    Object.defineProperty(response, broken, {
      get: () => {
        throw new Error("ad-fake slack response fault");
      },
    });
    return response;
  };
  return Object.assign(handler, { preconnect: globalThis.fetch.preconnect });
}
