import type { ReplayRecordingSummary } from "@growthmind/shared";
import { REPLAY_FAILURE_MESSAGES, REPLAY_LIST_UNREADABLE, logger } from "@growthmind/shared";

import { resolveReplayDeps, type ReplayRouteDeps } from "@/lib/replay/deps";
import { listRefusal, replaySourceRefusal } from "@/lib/replay/refusals";

export const dynamic = "force-dynamic";

// One page is what a person can look through; the walk exists for the pipeline, not for
// this screen. `sinceAt: null` because a viewer wants the most recent, not the unseen.
const PAGES_PER_VIEW = 1;

export async function handle(_request: Request, deps: ReplayRouteDeps): Promise<Response> {
  const ctx = await deps.tenant();
  if (ctx === null) {
    return listRefusal("signed_out");
  }

  const resolved = await deps.sourceFor(ctx);
  if (!resolved.ok) {
    return replaySourceRefusal(resolved.code);
  }

  let result;
  try {
    result = await resolved.source.listRecordings({ sinceAt: null, maxPages: PAGES_PER_VIEW });
  } catch (error) {
    logger.error("replays: the recording list could not be read", { error });
    return Response.json({ message: REPLAY_LIST_UNREADABLE }, { status: 503 });
  }

  if (!result.ok) {
    // Partial recordings are still shown: a rate limit part-way through a page is a
    // shorter list, not an error screen over rows we already hold (D8).
    if (result.partialRecordings.length === 0) {
      return Response.json(
        { message: REPLAY_FAILURE_MESSAGES[result.failure.code] },
        { status: 502 },
      );
    }

    return Response.json({
      recordings: result.partialRecordings.map(toListed),
      truncated: true,
      message: REPLAY_FAILURE_MESSAGES[result.failure.code],
    });
  }

  return Response.json({
    recordings: result.recordings.map(toListed),
    truncated: result.stop === "page_cap",
  });
}

// `meta` is already an allowlist at the adapter (duration, the three activity counts,
// console errors, start url — no identity, no typed content), so it crosses whole rather
// than being filtered a second time here against a list that could drift from that one.
function toListed(recording: ReplayRecordingSummary) {
  return {
    recordingId: recording.recordingId,
    startedAt: recording.startedAt?.toISOString() ?? null,
    lastActivityAt: recording.lastActivityAt?.toISOString() ?? null,
    meta: recording.meta,
  };
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, resolveReplayDeps());
}
