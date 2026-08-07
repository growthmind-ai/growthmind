import type { SlackReceiptFacts } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

import { authoritativeSlackReceipt } from "../../src/notifications/receipt";

// FR-4 req 1: one notification can hold several receipts once the rescue writes a second
// row, and what the org is told is decided here, once — sent ▸ failed ▸ quiet, ties
// newest first, and `pending` never speaks.

const T1 = new Date("2026-08-01T09:00:00.000Z");
const T2 = new Date("2026-08-02T09:00:00.000Z");
const T3 = new Date("2026-08-03T09:00:00.000Z");

function receipt(
  status: SlackReceiptFacts["status"],
  createdAt: Date,
  overrides: Partial<SlackReceiptFacts> = {},
): SlackReceiptFacts {
  return {
    channel: "slack",
    target: "C01AB2CD3EF",
    status,
    quietReason: status === "quiet" ? "no_channel" : null,
    failureReason: status === "failed" ? "call_failed" : null,
    messageRef: null,
    channelLabel: null,
    sentAt: status === "sent" ? createdAt : null,
    createdAt,
    ...overrides,
  };
}

describe("the authoritative receipt is sent over failed over quiet, newest first, and never pending", () => {
  test("a sent receipt beats a newer failed one — a rescue's success is what the org is told", () => {
    const sent = receipt("sent", T1, { target: "C0SENTROW01" });
    const laterFailure = receipt("failed", T2, { target: "C0FAILROW01" });

    expect(authoritativeSlackReceipt([laterFailure, sent])?.target).toBe("C0SENTROW01");
    expect(authoritativeSlackReceipt([sent, laterFailure])?.target).toBe("C0SENTROW01");
  });

  test("a failed receipt beats a newer quiet one — the crossing that was attempted outranks the one that was not", () => {
    const failed = receipt("failed", T1, { target: "C0FAILROW02" });
    const laterQuiet = receipt("quiet", T2, { target: "none" });

    expect(authoritativeSlackReceipt([laterQuiet, failed])?.target).toBe("C0FAILROW02");
  });

  test("two rows of the same status: the newest wins", () => {
    const older = receipt("sent", T1, { target: "C0OLDSENT01" });
    const newer = receipt("sent", T3, { target: "C0NEWSENT01" });

    expect(authoritativeSlackReceipt([older, newer])?.target).toBe("C0NEWSENT01");
    expect(authoritativeSlackReceipt([newer, older])?.target).toBe("C0NEWSENT01");
  });

  test("an empty list is null — no chip beats a guessed one", () => {
    expect(authoritativeSlackReceipt([])).toBeNull();
  });

  test("pending is never selected — the dispatch job still owns the outcome", () => {
    expect(authoritativeSlackReceipt([receipt("pending", T3)])).toBeNull();

    // Even against a quiet row, the in-flight claim says nothing: the settled receipt
    // speaks until the job writes a better one.
    const quiet = receipt("quiet", T1, { target: "none" });
    expect(authoritativeSlackReceipt([receipt("pending", T3), quiet])?.status).toBe("quiet");
  });
});
