// The Slack implementation of the `DeliveryPoster` port (O-007), over Slack's
// `chat.postMessage` Web API.
//
// ── THIS FUNCTION NEVER THROWS ──────────────────────────────────────────────
// The port says so in words (`packages/shared/src/delivery/poster.ts`), and it
// says why: the caller is a worker task whose D8 obligation is that a delivery
// failure leaves the pipeline's persisted state intact. One escaping throw
// turns that obligation back into something a human has to remember at every
// call site. So EVERY exit here is a `PostResult` — serialisation, transport,
// timeout, abort, non-2xx, `{ok:false}`, an unreadable body, a body that is not
// JSON at all, and a `Response` whose own methods misbehave.
//
// ── HTTP 200 IS NOT SUCCESS ─────────────────────────────────────────────────
// The classic bug against this API. Slack answers `chat.postMessage` with
// HTTP 200 and `{"ok":false,"error":"channel_not_found"}` — the status says the
// call was served, the body says the message was not posted. Success here
// requires BOTH a 2xx and `ok: true` AND a non-empty `ts`; a named test pins it.
//
// ── NO SDK ──────────────────────────────────────────────────────────────────
// `@slack/web-api` is not taken as a dependency. One POST to one documented
// endpoint does not need a client library, and self-hosting is first-class
// here: every dependency is something a customer has to pull, audit, and keep
// patched inside their own network. The injected `fetch` also makes the whole
// adapter drivable with no network at all, which an SDK's own transport would
// have taken away.
//
// ── NO RETRY LOOP ───────────────────────────────────────────────────────────
// Deliberate; see `./deps.ts`. A 429 comes back as the retryable `call_failed`
// and the scheduler decides when to try again.
import type { DeliveryPoster, PostRequest, PostResult } from "@growthmind/shared";
import { z } from "zod";

import { MAX_RESPONSE_BYTES, REQUEST_TIMEOUT_MS, SLACK_POST_MESSAGE_URL } from "./constants";
import type { SlackPosterConfig, SlackPosterDeps } from "./deps";
import { mapSlackError, postFailure } from "./errors";

/**
 * Slack's reply envelope, parsed PERMISSIVELY and for three fields only.
 *
 * External data, so it is validated rather than trusted (D5) — but the parser's
 * job is to find `ok`, `ts` and `error`, not to certify Slack's response shape.
 * Unknown keys are stripped: `chat.postMessage` echoes the whole posted message
 * back under `message`, and this adapter has no business holding onto that.
 *
 * A body that fails this parse — an HTML error page from a proxy, an empty
 * body, a JSON array, `{"ok":"true"}` — is NOT quietly treated as either
 * outcome. It becomes `call_failed`: we genuinely do not know what happened,
 * and "the call did not complete" is the only thing such a response
 * establishes.
 */
const slackPostMessageResponseSchema = z.object({
  ok: z.boolean(),
  ts: z.string().optional(),
  error: z.string().optional(),
});

/**
 * Reads a response body without ever throwing across this boundary.
 *
 * Returns `null` for anything unreadable, which the caller then maps to
 * `call_failed`. Note this is deliberately simpler than
 * `../posthog/client.ts`'s byte-counting stream reader: that one walks pages
 * whose urls the remote supplies, so it must assume a hostile body; here the
 * url is a compile-time constant naming one endpoint, the reply is a few
 * hundred bytes, and the declared-length check plus a post-read cap covers the
 * only realistic case (a proxy or captive portal answering with a page).
 */
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

    // Annotated rather than asserted: `JSON.parse` returns `any`, and widening
    // it to `unknown` at the binding keeps that `any` from escaping this
    // function without a cast.
    const decoded: unknown = JSON.parse(text);
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Builds a poster bound to one workspace's credential.
 *
 * Config and deps are separate arguments for the reason `../posthog/client.ts`
 * separates them: the credential belongs to the customer's row and changes per
 * call site, while the effects belong to the process and are the same for every
 * one of them.
 */
export function createSlackDeliveryPoster(
  config: SlackPosterConfig,
  deps: SlackPosterDeps,
): DeliveryPoster {
  // Built once. It is a Bearer credential and cannot reach a returned message —
  // every sentence comes from `./errors.ts`'s fixed table, reachable only
  // through a `PostFailureCode`.
  const authorization = `Bearer ${config.botToken}`;

  return {
    async post(request: PostRequest): Promise<PostResult> {
      // The outer guard. Given the inner ones below it is unreachable today,
      // and it stays because "never throws" should be a property of this
      // function's SHAPE rather than of a reviewer having checked every `await`
      // in it — including the ones a later edit adds.
      try {
        let body: string;
        try {
          body = JSON.stringify({
            channel: request.channelId,
            blocks: request.blocks,
            // Slack's own field name for the plaintext fallback. Never omitted:
            // a blocks-only message is silent in a notification preview and to
            // a screen reader, which the port states as the caller's invariant.
            text: request.fallbackText,
          });
        } catch {
          // `blocks` is `readonly unknown[]` at the port, so it can carry a
          // circular structure or a BigInt, and `JSON.stringify` throws on
          // both. A payload we cannot even serialise is one Slack would never
          // accept, so it is `rejected` — terminal — and, importantly, we
          // never open a socket for it.
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
            // A redirect goes wherever the upstream points; treat one as a
            // response to be read, never as a hop to follow (the H-3 rule
            // `../posthog/client.ts` applies for the same reason).
            redirect: "manual",
            // Without this, a host that accepts the connection and never
            // answers holds this delivery tick open indefinitely. The abort
            // rejects `fetch`, and lands in the catch below as `call_failed`.
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        } catch {
          // Transport fault, DNS failure, TLS failure, or the timeout above.
          // All retryable: none of them says anything about the message or the
          // connection.
          return postFailure("call_failed");
        }

        const parsed = slackPostMessageResponseSchema.safeParse(await readJsonBody(response));
        if (!parsed.success) {
          return postFailure("call_failed");
        }
        const envelope = parsed.data;

        if (envelope.ok) {
          // `ok: true` on a non-2xx is a contradiction, so it is not read as
          // success. It has never been observed; it costs one branch to make
          // sure the only success path in this file needs the status AND the
          // body to agree.
          if (!response.ok) {
            return postFailure("call_failed");
          }

          const messageRef = envelope.ts ?? "";
          if (messageRef.length === 0) {
            // Slack documents `ts` on every successful `chat.postMessage`, so
            // this shape means we are not talking to Slack-as-documented and
            // genuinely do not know whether the message landed. `call_failed`
            // is the honest code — it claims only that the call did not
            // complete usefully — and it is RETRYABLE, which does mean a post
            // that did land could be posted twice. That hazard is not created
            // here: a worker retried after a successful post but before its row
            // commits produces exactly the same duplicate, so the caller's
            // idempotency guard has to exist regardless (FR-18). Returning
            // success is not open to us anyway — the port requires a non-empty
            // `messageRef` and inventing one would poison the threading key.
            return postFailure("call_failed");
          }

          return { ok: true, messageRef };
        }

        // The `{ok:false}` arm, whatever the status was. Slack's own `error`
        // string is read here and NOWHERE ELSE, and `mapSlackError` returns a
        // code rather than any text — see `./errors.ts` for why that shape is
        // the redaction guarantee.
        return postFailure(mapSlackError(envelope.error));
      } catch {
        return postFailure("call_failed");
      }
    },
  };
}
