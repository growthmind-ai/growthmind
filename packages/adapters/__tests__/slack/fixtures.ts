// Test doubles for the Slack delivery adapter. Fakes, never mocks: a fake `fetch` that
// serves canned responses and records exactly what was sent.
//
// Nothing here touches the network. Every test in this directory drives the real
// `createSlackDeliveryPoster`. The injected `fetch` is the only impure thing the
// adapter can reach, so a fake for it is total rather than best-effort.
//
// Fixture seed prefix: `ad-`, matching `../helpers/fakes.ts`. Every token, channel id
// and team id below is an obviously-fake placeholder. This repo is public.
import type { PostRequest } from "@growthmind/shared";

import type { SlackPosterConfig, SlackPosterDeps } from "../../src/slack/deps";

/** Obviously fake, and long enough that a substring assertion on it means something. */
export const AD_SLACK_BOT_TOKEN = "xoxb-ad-fake-not-a-real-bot-token-000000000000";

export const AD_SLACK_CHANNEL_ID = "C0ADFAKECHANNEL";

export const AD_SLACK_CONFIG: SlackPosterConfig = { botToken: AD_SLACK_BOT_TOKEN };

/** The handle Slack returns for a posted message, in its documented shape. */
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
  /** The serialised request body, or `null` if it was not a string. */
  readonly body: string | null;
}

export interface FakeSlackResponseSpec {
  readonly status?: number;
  /** Serialised to the body. Ignored when `text` is given. */
  readonly json?: unknown;
  /** Raw body text, for bodies that are not JSON at all. */
  readonly text?: string;
  readonly headers?: Record<string, string>;
  /** `fetch` itself rejects: the network is down. */
  readonly networkError?: boolean;
  /** `fetch` rejects the way `AbortSignal.timeout` makes it reject. */
  readonly timeout?: boolean;
}

export interface FakeSlackFetch {
  readonly fetch: SlackPosterDeps["fetch"];
  readonly requests: RecordedSlackRequest[];
}

/**
 * Serves one canned response to every call, and records what was sent.
 *
 * Deliberately not a sequenced fake. This adapter makes at most one request per `post`.
 * It has no retry loop by design (`../../src/slack/deps.ts`), so a response sequence
 * would be a helper no test could ever justify, and the request recorder is what proves
 * the "at most one" claim instead.
 *
 * `preconnect` is carried over from the real `fetch` purely to satisfy the platform's
 * own signature. It is never called, so no connection is ever opened.
 */
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
    // An empty body is passed as `null`, not `""`: the platform's `Response` refuses a
    // non-null body on a null-body status, and a test asking for "an empty
    // 204" wants an empty 204, not a constructor throw that would arrive at the adapter
    // looking like a transport fault.
    return new Response(body.length === 0 ? null : body, {
      status: spec.status ?? 200,
      headers: { "content-type": "application/json", ...spec.headers },
    });
  };

  return { fetch: Object.assign(handler, { preconnect: globalThis.fetch.preconnect }), requests };
}

/**
 * A `Response` whose own accessors misbehave. The shape a resilient reader is supposed
 * to survive and a naive one is not. `headers` throwing covers a platform/polyfill
 * fault before the body is touched; `text` throwing covers a connection that dies
 * mid-body.
 */
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
