// The one place the server tells a browser something changed. Nothing here answers a
// question the browser asked on a timer — the stream stays open and writes when there is
// something to say.
import { LIVE_EVENT_NAME, LIVE_KEEPALIVE_MS, type LiveTopic } from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { requireTenant } from "@/lib/first-run/gate";
import { watchLive } from "@/lib/live/hub";

export const dynamic = "force-dynamic";

export function streamFor(organizationId: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encode = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;

      const write = (chunk: string): void => {
        if (!open) return;
        try {
          controller.enqueue(encode.encode(chunk));
        } catch {
          // The browser went away between the check and the write. Nothing to recover.
          open = false;
        }
      };

      const stop = watchLive(organizationId, (topic: LiveTopic) => {
        write(`event: ${LIVE_EVENT_NAME}\ndata: ${JSON.stringify({ topic })}\n\n`);
      });

      // A comment on the open stream so an idle proxy does not close it. Not a poll: nothing
      // is requested and nothing is read back.
      const keepalive = setInterval(() => {
        write(": keepalive\n\n");
      }, LIVE_KEEPALIVE_MS);

      const close = (): void => {
        if (!open) return;
        open = false;
        clearInterval(keepalive);
        stop();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime tearing the response down.
        }
      };

      signal.addEventListener("abort", close, { once: true });

      // Something has to reach the browser before it will treat the connection as live.
      write(": open\n\n");
    },
  });
}

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  // The organization comes from the session and nowhere else — a stream addressed by a
  // query parameter would hand one tenant another's changes (D7).
  return new Response(streamFor(gate.ctx.organizationId, request.signal), {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Nginx and friends buffer a response body by default, which holds every event until
      // the stream closes — the exact opposite of what this route is for.
      "x-accel-buffering": "no",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
