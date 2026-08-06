import { REPLAY_FAILURE_MESSAGES, REPLAY_LIST_UNREADABLE, logger } from "@growthmind/shared";

import { resolveReplayDeps, type ReplayRouteDeps } from "@/lib/replay/deps";
import { listRefusal, replaySourceRefusal } from "@/lib/replay/refusals";

export const dynamic = "force-dynamic";

export async function handle(
  _request: Request,
  recordingId: string,
  deps: ReplayRouteDeps,
): Promise<Response> {
  const ctx = await deps.tenant();
  if (ctx === null) {
    return listRefusal("signed_out");
  }

  // The id is the customer's own string and reaches the vendor's URL. The adapter encodes
  // it and guards the origin of any next page; this refuses the empty case here so a bare
  // `/events` cannot become a list call against the wrong path.
  if (recordingId.trim() === "") {
    return Response.json({ message: REPLAY_FAILURE_MESSAGES.recording_not_found }, { status: 404 });
  }

  const resolved = await deps.sourceFor(ctx);
  if (!resolved.ok) {
    return replaySourceRefusal(resolved.code);
  }

  let result;
  try {
    result = await resolved.source.pullEvents(recordingId);
  } catch (error) {
    logger.error("replays: a recording's events could not be read", { error });
    return Response.json({ message: REPLAY_LIST_UNREADABLE }, { status: 503 });
  }

  if (!result.ok) {
    // Same D8 shape as the list: events already in hand still play, and the player says
    // the tail is missing rather than refusing to show what arrived.
    if (result.partialEvents.length === 0) {
      const status = result.failure.code === "recording_not_found" ? 404 : 502;
      return Response.json({ message: REPLAY_FAILURE_MESSAGES[result.failure.code] }, { status });
    }

    return Response.json({
      events: result.partialEvents,
      truncated: true,
      message: REPLAY_FAILURE_MESSAGES[result.failure.code],
    });
  }

  return Response.json({
    events: result.events,
    truncated: result.stop === "page_cap" || result.stop === "byte_cap",
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ recordingId: string }> },
): Promise<Response> {
  const { recordingId } = await context.params;
  return handle(request, recordingId, resolveReplayDeps());
}
