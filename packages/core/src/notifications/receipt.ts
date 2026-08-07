import type { SlackReceiptFacts } from "@growthmind/shared";

// One notification can hold several receipts — a rescue writes a second row, because a
// quiet receipt targets no channel and a later real send targets one. Precedence is
// sent ▸ failed ▸ quiet, ties newest first, and `pending` is never selected: it means the
// dispatch job still owns the outcome, which is the answer an absent receipt already gets.
export function authoritativeSlackReceipt(
  _sends: readonly SlackReceiptFacts[],
): SlackReceiptFacts | null {
  throw new Error("O-051 job 2: not implemented");
}
