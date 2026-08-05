import { REPLAY_FAILURE_MESSAGES, REPLAY_NO_CONNECTION } from "@growthmind/shared";

import type { ReplaySourceRefusal } from "./deps";

const SIGNED_OUT_MESSAGE = "Sign in to watch your recordings.";

export function listRefusal(code: "signed_out"): Response {
  return Response.json({ code, message: SIGNED_OUT_MESSAGE }, { status: 401 });
}

// 200 with an empty list rather than an error status: "you have not connected analytics"
// is a state of the page, not a failure of the request, and the screen it renders is an
// invitation rather than a stack trace.
export function replaySourceRefusal(code: ReplaySourceRefusal): Response {
  if (code === "no_connection") {
    return Response.json({ recordings: [], connected: false, message: REPLAY_NO_CONNECTION });
  }

  return Response.json({ code, message: REPLAY_FAILURE_MESSAGES.misconfigured }, { status: 503 });
}
