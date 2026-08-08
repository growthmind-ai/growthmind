import type { SlackReceiptFacts } from "@growthmind/shared";

const PRECEDENCE = { sent: 3, failed: 2, quiet: 1 } as const;

type SettledStatus = keyof typeof PRECEDENCE;

function rankOf(send: SlackReceiptFacts): number | null {
  return send.status in PRECEDENCE ? PRECEDENCE[send.status as SettledStatus] : null;
}

// One notification can hold several receipts — a rescue writes a second row, because a
// quiet receipt targets no channel and a later real send targets one. Precedence is
// sent ▸ failed ▸ quiet, ties newest first, and `pending` is never selected: it means the
// dispatch job still owns the outcome, which is the answer an absent receipt already gets.
export function authoritativeSlackReceipt(
  sends: readonly SlackReceiptFacts[],
): SlackReceiptFacts | null {
  let best: SlackReceiptFacts | null = null;
  let bestRank = 0;

  for (const send of sends) {
    const rank = rankOf(send);
    if (rank === null) {
      continue;
    }

    if (
      best === null ||
      rank > bestRank ||
      (rank === bestRank && send.createdAt.getTime() > best.createdAt.getTime())
    ) {
      best = send;
      bestRank = rank;
    }
  }

  return best;
}
