import {
  POST_FAILURE_MESSAGES,
  RESIDUAL_PII_KIND_MESSAGES,
  deliveryFailureSentence,
  parseRenderedMessage,
  type PostFailureCode,
  type RenderedMessage,
  type ResidualPiiKind,
} from "@growthmind/shared";

export type DeliveryStateKey =
  "posted" | "posted_retried" | "posting" | "stalled" | "failed" | "held_back";

// The columns this page derives from, named as their own type so the pure functions can be
// exercised without a `deliveries` row and without a database.
export interface DeliveryFacts {
  readonly status: "pending" | "posted" | "failed";
  readonly attempts: number;
  readonly claimedAt: Date;
  readonly postedAt: Date | null;
  readonly failedAt: Date | null;
  readonly failureReason: string | null;
  readonly renderedMessage: unknown;
}

export type FailureCause =
  | { readonly kind: "post_failure"; readonly code: PostFailureCode | null }
  | { readonly kind: "residual_pii"; readonly pii: ResidualPiiKind };

// `failure_reason` is free `text`, and Slack's own error bodies carry internal ids. So the
// stored sentence is matched against the shared vocabulary and thrown away either way: what
// reaches the screen is the constant this map resolves to, never the column.
const FAILURE_CODE_BY_SENTENCE: ReadonlyMap<string, PostFailureCode> = new Map(
  Object.keys(POST_FAILURE_MESSAGES).flatMap(
    (key): readonly (readonly [string, PostFailureCode])[] => {
      const code = key as PostFailureCode;
      return [
        [POST_FAILURE_MESSAGES[code], code],
        [deliveryFailureSentence(code), code],
      ];
    },
  ),
);

const PII_KIND_BY_SENTENCE: ReadonlyMap<string, ResidualPiiKind> = new Map(
  Object.keys(RESIDUAL_PII_KIND_MESSAGES).map((key) => {
    const pii = key as ResidualPiiKind;
    return [RESIDUAL_PII_KIND_MESSAGES[pii], pii] as const;
  }),
);

export function readFailureCause(failureReason: string | null): FailureCause {
  const stored = (failureReason ?? "").trim();

  const pii = PII_KIND_BY_SENTENCE.get(stored);
  if (pii !== undefined) {
    return { kind: "residual_pii", pii };
  }

  return { kind: "post_failure", code: FAILURE_CODE_BY_SENTENCE.get(stored) ?? null };
}

// A residual-PII hold is stored as `failed` like any outage, so the lane it belongs to is
// read from the reason rather than the status column.
export function deriveDeliveryState(
  facts: DeliveryFacts,
  staleClaimsBefore: Date,
): DeliveryStateKey {
  if (facts.status === "pending") {
    return facts.claimedAt.getTime() < staleClaimsBefore.getTime() ? "stalled" : "posting";
  }

  if (facts.status === "failed") {
    return readFailureCause(facts.failureReason).kind === "residual_pii" ? "held_back" : "failed";
  }

  return facts.attempts > 1 ? "posted_retried" : "posted";
}

export type MessageHold =
  | { readonly kind: "held"; readonly message: RenderedMessage }
  // Posted with no stored render: the row predates the column, and re-rendering the finding
  // would put a clause in Slack's mouth that Slack never carried.
  | { readonly kind: "predates_record" }
  // Nothing was posted, so there is no sent message to hold in the first place.
  | { readonly kind: "never_sent" };

export function holdOf(facts: DeliveryFacts): MessageHold {
  const message = parseRenderedMessage(facts.renderedMessage);
  if (message !== null) {
    return { kind: "held", message };
  }

  return facts.status === "posted" ? { kind: "predates_record" } : { kind: "never_sent" };
}

export interface ConnectedChannel {
  readonly channelId: string;
  readonly channelName: string | null;
}

// A founder cannot recognise `C0FIN…`, so an address is either named or described. Deliberately
// not `channelLabel`, whose documented fallback is the raw id.
export function describeChannel(
  deliveryChannelId: string,
  connection: ConnectedChannel | null,
): string {
  if (connection === null || connection.channelId !== deliveryChannelId) {
    return "the channel connected at the time";
  }

  const name = (connection.channelName ?? "").trim().replace(/^#+/, "").trim();
  return name.length > 0 ? `#${name}` : "the connected channel";
}

export function ordinal(n: number): string {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}
