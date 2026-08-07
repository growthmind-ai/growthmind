// What the page says when one of its four reads did not answer. Held apart from the states
// that describe the workspace itself: an absence is calm and names a next step, a failed read
// is ours and names none, because a repair offered for a fault nobody established is worse
// than saying nothing.

export const CONNECTION_UNREAD_HEAD = "We could not check where your findings are being sent";

export const CONNECTION_UNREAD_BODY =
  "Nothing has been disconnected and nothing has been undone — this is our view of the " +
  "connection, not the connection. There is nothing here for you to reconnect.";

export const RECORD_UNREAD_HEAD = "We could not read your delivery record just now";

export const RECORD_UNREAD_BODY =
  "This is our end, not yours. It does not say that nothing was sent — it says we could not " +
  "fetch what we sent. Reloading in a minute usually brings it back. If it keeps saying this, " +
  "tell us.";

export const EMPTY_UNREAD_CONNECTION_BODY =
  "Nothing has been delivered — that much we can see. Where it would be sent we could not " +
  "check just now, so we are not going to tell you to press anything until we can.";

export const LANE_UNREAD =
  "We could not read whether a check has run recently. The checks themselves carry on without " +
  "this page; it is only our view of them that is missing.";

export const LANE_HISTORY_UNREAD = "We could not read what it has been doing before now.";

export const DISMISSALS_UNREAD =
  "We could not read whether anything below was marked Not useful in Slack, so a card may be " +
  "missing that line. What was sent, and whether it arrived, is unaffected.";
