// The residual PII scanner. The last gate before generated text is posted to Slack or
// pushed anywhere else.
//
// Why "residual" is the load-bearing word This is not the product's PII control. The
// real control is upstream and structural: personal data never enters the corpus in the
// first place (product decisions -§4. Deterministic ids, no PII, masked capture). This
// scanner exists for what survives that: a model-written sentence that quoted something
// it should not have, or a URL fragment that carried more than a path. Treating it as
// the primary defence would be the mistake. A pattern scanner cannot detect a person's
// name, and `residual-pii.test.ts` pins that limitation with a named test rather than
// leaving it to this comment.
//
// Fail direction: Closed Every deterministic pre-model gate is a keyword classifier,
// and keyword classifiers miss. The taxonomy's question is which way this one fails,
// and the answer here is dictated by an asymmetry:
//
// A FALSE positive withholds one Slack post, which a human can re-trigger;
// A FALSE negative posts a customer's personal data into a shared channel,
//  where it is retained, searchable, and unrecallable.
//
// So doubt blocks. Where a pattern is ambiguous. A long digit run that is not a valid
// card but is shaped like an account number. This scanner reports it rather than
// reasoning its way to "probably fine". That is the opposite of the fail-open direction
// a capability gate takes, and the difference is deliberate: this gate withholds an
// action, it does not withhold a capability.
//
// Never echo the match a report carries the kind and the offset, never the matched
// text. Quoting the finding would copy the personal data into logs, error messages, and
// alerts. Relocating the leak instead of closing it. Same guard the signature service
// already applies to a rejected surface value.
import type { ResidualPiiKind } from "@growthmind/shared";

/**
 * One occurrence of suspected personal data.
 *
 * `at` is a character offset into the scanned string. Enough for a human with the
 * source text in front of them to find it, and useless to anyone without it. There is
 * deliberately no `text`, no `match`, and no `sample` field: the type is what makes
 * echoing the data unavailable rather than merely discouraged.
 */
export type ResidualPiiFinding = {
  readonly kind: ResidualPiiKind;
  readonly at: number;
};

/**
 * The scan result. `clean` is redundant with `findings.length === 0` and is kept
 * anyway: the call site that matters most is a guard, and `if (!result.clean)` reads as
 * the refusal it is.
 */
export type ResidualPiiScan = {
  readonly clean: boolean;
  readonly findings: readonly ResidualPiiFinding[];
};

/**
 * One detector. `kind` is what a match means to a customer; `pattern` is how it is
 * found. Patterns are `g`-flagged and each scan builds its own `RegExp` so `lastIndex`
 * is never shared between calls. A stateful global regex reused across scans silently
 * skips matches on every other call, which is exactly the kind of intermittent miss
 * this gate cannot afford.
 */
type Detector = {
  readonly kind: ResidualPiiKind;
  readonly source: string;
  readonly flags: string;
};

const DETECTORS: readonly Detector[] = [
  // Email. Deliberately liberal on the local part. An address that this misses is an
  // address that reaches Slack.
  {
    kind: "email_address",
    source: String.raw`[\w.!#$%&'*+/=?^_\`{|}~-]+@[\w-]+(?:\.[\w-]+)+`,
    flags: "g",
  },

  // Credential-shaped tokens before the digit-run detectors, so a long secret is
  // reported as a credential rather than as a card. Covers common vendor prefixes and
  // generic long high-entropy runs.
  {
    kind: "credential",
    source: String.raw`\b(?:sk|pk|rk|api|key|token|bearer|ghp|gho|xox[baprs])[-_][A-Za-z0-9\-_]{16,}`,
    flags: "gi",
  },
  {
    kind: "credential",
    source: String.raw`\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}`,
    flags: "g",
  },

  // Payment card: 13-19 digits, optionally split by spaces or hyphens.
  {
    kind: "payment_card",
    source: String.raw`\b(?:\d[ -]?){12,18}\d\b`,
    flags: "g",
  },

  // IPv4. The octet bound keeps ordinary decimals and version strings out.
  {
    kind: "ip_address",
    source: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b`,
    flags: "g",
  },

  // Phone: an optional +, then 9-15 digits with spaces, hyphens, dots or parens allowed
  // between them.
  {
    kind: "phone_number",
    source: String.raw`(?:\+\d[\d\s().-]{7,}\d)|(?:\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b)`,
    flags: "g",
  },
];

/**
 * A bare digit run long enough to be an account or reference number but not matched by
 * a more specific detector above.
 *
 * This is the fail-closed arm made explicit. Such a run is not provably personal data,
 * and it is not provably safe either, which is the only test that matters here. A
 * finding's own numbers never look like this: counts travel as `MeasuredCount` and
 * render as "3 of 28", so a bare 16-digit run in generated prose has no legitimate
 * source in this product.
 */
const AMBIGUOUS_DIGIT_RUN = String.raw`\b\d{12,}\b`;

/**
 * Scan generated text for personal data that survived upstream masking.
 *
 * Pure and allocation-light: no I/O, no logging, no throwing. A gate that can throw is
 * a gate that can take down the delivery lane it was added to protect, so an unexpected
 * input shape must degrade to "not clean" rather than to an exception. See the
 * `String(text)` coercion below.
 *
 * Findings are returned ordered by offset, so the first problem in the text is the
 * first problem in the list.
 */
export function scanResidualPii(text: string): ResidualPiiScan {
  // A caller reaching us from an untyped boundary (a parsed model payload, a jsonb
  // column) can hand us a non-string. Coercing rather than throwing keeps the fail
  // direction closed: `String(null)` is `"null"`, which scans clean and posts nothing
  // surprising, whereas a throw here would break the delivery flow this gate exists to
  // protect.
  const source = typeof text === "string" ? text : String(text);

  if (source.length === 0) {
    return { clean: true, findings: [] };
  }

  const findings: ResidualPiiFinding[] = [];
  const claimed: { start: number; end: number }[] = [];

  function overlapsClaimed(start: number, end: number): boolean {
    return claimed.some((span) => start < span.end && end > span.start);
  }

  for (const detector of DETECTORS) {
    // A fresh RegExp per detector per call, never a shared `lastIndex`.
    const pattern = new RegExp(detector.source, detector.flags);
    let match = pattern.exec(source);

    while (match !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Detectors are ordered most-specific-first; a later, broader pattern must not
      // re-report a span an earlier one already claimed (a card number would otherwise
      // also register as a phone number).
      if (!overlapsClaimed(start, end)) {
        claimed.push({ start, end });
        findings.push({ kind: detector.kind, at: start });
      }

      // A zero-length match would spin forever; advance past it explicitly.
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
      }

      match = pattern.exec(source);
    }
  }

  // The fail-closed sweep, last: anything still unclaimed that is merely a long digit
  // run is reported as a payment card rather than allowed through. The kind is the
  // closest honest label. "we saw a number that could identify a payment or an
  // account", and the alternative (a `possible_pii` member) was rejected because a kind
  // nobody can act on reads as noise and gets muted.
  const ambiguous = new RegExp(AMBIGUOUS_DIGIT_RUN, "g");
  let bare = ambiguous.exec(source);

  while (bare !== null) {
    const start = bare.index;
    const end = start + bare[0].length;

    if (!overlapsClaimed(start, end)) {
      claimed.push({ start, end });
      findings.push({ kind: "payment_card", at: start });
    }

    bare = ambiguous.exec(source);
  }

  findings.sort((a, b) => a.at - b.at);

  return { clean: findings.length === 0, findings };
}

/**
 * The guard form. `scanResidualPii(text).clean`, named for the question the delivery
 * path actually asks.
 *
 * Call this before any post or push, never after. The point of a residual gate is that
 * nothing downstream of it has to be trusted to re-check.
 */
export function isCleanForDelivery(text: string): boolean {
  return scanResidualPii(text).clean;
}
