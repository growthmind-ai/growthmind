// items 28–30, the plain-English audit over the one home every customer-facing string
// in this sprint lives in.
//
// This audit is total rather than best-effort: every fixed string is reachable through
// `ALL_CUSTOMER_FACING_MESSAGES`, and the completeness test below is what fails when a
// new constant is added without registering it there.
import { describe, expect, test } from "bun:test";

import * as messagesModule from "../../src/session-source/messages";
import {
  ALL_CUSTOMER_FACING_MESSAGES,
  CONNECTION_STATE_MESSAGES,
  CONNECT_REFUSAL_MESSAGES,
  COUNTER_COMPLETENESS_STATEMENT,
  COUNTER_WINDOW_STATEMENT,
  EXCLUSION_REASON_LABELS,
  SOURCE_ABSENT_NOTICE,
  SOURCE_DEGRADED_NOTICE,
  expectedLagStatement,
  secondSourceRefusalMessage,
} from "../../src/session-source/messages";
import { connectRefusalCodeSchema, connectionStateSchema } from "../../src/session-source/types";

/** Word-boundary, so "delivered" is fine and "live" is not. */
const LIVE_CLAIM = /\blive\b/i;

const EXISTING_CONNECTION = {
  host: "analytics.example.invalid",
  sourceProjectId: "s0-source-project",
};

/** Every string the sprint can put in front of a customer, builders included. */
function everyMessage(): string[] {
  return [
    ...ALL_CUSTOMER_FACING_MESSAGES,
    secondSourceRefusalMessage(EXISTING_CONNECTION),
    expectedLagStatement({ typicalSeconds: 85, worstCaseSeconds: 280 }),
  ];
}

describe("the plain-English audit", () => {
  // Item 28, / the UX bar.
  test("no exported customer-facing message contains 'live' as a freshness claim", () => {
    // Addendum a row 4: PostHog stores the time the customer's own browser declared and
    // exposes no arrival time by any route, so an event can land behind everything we
    // have already read. Nothing here may imply otherwise.
    const offenders = everyMessage().filter((message) => LIVE_CLAIM.test(message));
    expect(offenders).toEqual([]);
  });

  // Item 29, the P-2 plain-English bar.
  test("no exported customer-facing message contains a forbidden jargon token", () => {
    const jargon = [
      "tenant",
      "adapter",
      "watermark",
      "idempotent",
      "upsert",
      "jsonb",
      "endpoint",
      "null",
      "undefined",
    ];

    const offenders: string[] = [];
    for (const message of everyMessage()) {
      for (const token of jargon) {
        if (new RegExp(`\\b${token}\\b`, "i").test(message)) {
          offenders.push(`${token} in: ${message}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("no exported customer-facing message contains a bare HTTP status code", () => {
    // "The request failed with 401" is exactly the jargon the bar forbids: PostHog's
    // own `detail` text never reaches a customer, it is mapped to one of these strings
    // instead.
    //
    // This used to scan only the fixed `ALL_CUSTOMER_FACING_MESSAGES` list, missing the
    // templated messages (`secondSourceRefusalMessage`, `expectedLagStatement`)
    // entirely, so a bare status hardcoded into a template could ship undetected. Scan
    // every message the sprint can show a customer (`everyMessage`), but mask the one
    // interpolated field first. A PostHog project id is opaque customer data, not a
    // status code, and "404" or "500" are entirely plausible real project ids. An
    // unmasked scan would fail the audit on a customer's own id rather than on an
    // actual leak.
    const BARE_STATUS = /\b[1-5]\d{2}\b/;
    const maskedMessages = everyMessage().map((message) =>
      message.split(EXISTING_CONNECTION.sourceProjectId).join("s0-masked-project-id"),
    );

    const offenders = maskedMessages.filter((message) => BARE_STATUS.test(message));
    expect(offenders).toEqual([]);

    // Prove the masking is load-bearing, not vacuous: a project id that itself reads
    // like a status code must trip the raw (unmasked) scan. Otherwise this test would
    // pass even if the mask silently matched nothing, because s0-source-project never
    // looked like a status anyway.
    const statusLikeProjectId = "404";
    const rawWithStatusLikeId = secondSourceRefusalMessage({
      host: EXISTING_CONNECTION.host,
      sourceProjectId: statusLikeProjectId,
    });
    expect(BARE_STATUS.test(rawWithStatusLikeId)).toBe(true);
    expect(
      BARE_STATUS.test(rawWithStatusLikeId.split(statusLikeProjectId).join("s0-masked-project-id")),
    ).toBe(false);
  });

  test("the vendor's name never appears in a customer-facing message", () => {
    // The pipeline behind the port does not learn the vendor's name, and neither does
    // the copy, so a second source needs no copy rewrite.
    const offenders = everyMessage().filter((message) => /posthog/i.test(message));
    expect(offenders).toEqual([]);
  });

  // This used to compare two hand-maintained lists against each other,
  // `ALL_CUSTOMER_FACING_MESSAGES` against a second, separately typed copy of the same
  // constants. A new exported string added to the module but to neither list produced
  // `missing = []`, equal lengths, and a green test: it escaped the
  // "live"/jargon/HTTP-status audits above entirely, silently.
  //
  // Instead, derive the expected set from the module's actual exports (`import * as
  // messagesModule`) (the real source of truth) so a new fixed string constant is
  // picked up automatically the moment it is exported, with nothing to remember to copy
  // anywhere.
  test("the audit list is complete — every fixed constant is reachable through it", () => {
    const derivedFromExports: string[] = [];
    for (const [name, value] of Object.entries(messagesModule)) {
      // The derivation target itself is not part of its own input.
      if (name === "ALL_CUSTOMER_FACING_MESSAGES") continue;

      if (typeof value === "string") {
        // A bare exported string constant (COUNTER_WINDOW_STATEMENT and kin).
        derivedFromExports.push(value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        // A Record<..., string> constant (CONNECTION_STATE_MESSAGES and kin).
        for (const entry of Object.values(value)) {
          if (typeof entry === "string") derivedFromExports.push(entry);
        }
      }
      // Functions (secondSourceRefusalMessage, expectedLagStatement) are parameterised,
      // not fixed constants. They are audited explicitly via `everyMessage` above
      // instead of enumerated here.
    }

    const registered = new Set(ALL_CUSTOMER_FACING_MESSAGES);
    const missing = derivedFromExports.filter((message) => !registered.has(message));
    expect(missing).toEqual([]);
    expect(ALL_CUSTOMER_FACING_MESSAGES.length).toBe(derivedFromExports.length);
  });
});

describe("state and refusal coverage", () => {
  // Item 30, the seven states renders, none indistinguishable.
  test("every connection state and every connect refusal has a distinct plain-English message", () => {
    const statuses = connectionStateSchema.options.map((option) => option.shape.status.value);
    expect(statuses).toHaveLength(7);

    // Coverage: a state with no message would leave a screen with nothing to render; a
    // message with no state is dead copy.
    expect(Object.keys(CONNECTION_STATE_MESSAGES).toSorted()).toEqual(statuses.toSorted());
    expect(Object.keys(CONNECT_REFUSAL_MESSAGES).toSorted()).toEqual(
      connectRefusalCodeSchema.options.toSorted(),
    );

    // Distinctness: two situations must never read the same way on screen.
    const all = [
      ...Object.values(CONNECTION_STATE_MESSAGES),
      ...Object.values(CONNECT_REFUSAL_MESSAGES),
    ];
    expect(new Set(all).size).toBe(all.length);

    for (const message of all) {
      expect(message.trim().length).toBeGreaterThan(20);
      expect(message.trim().endsWith(".")).toBe(true);
    }
  });

  test("the set-aside labels cover every exclusion reason and read distinctly", () => {
    const labels = Object.values(EXCLUSION_REASON_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toHaveLength(5);
  });

  test("the second-source refusal names the existing attachment and the cutover path", () => {
    // A customer told only "already connected" has to open a support ticket to find out
    // which one to detach.
    const message = secondSourceRefusalMessage(EXISTING_CONNECTION);

    expect(message).toContain(EXISTING_CONNECTION.host);
    expect(message).toContain(EXISTING_CONNECTION.sourceProjectId);
    expect(message).toContain("Detach");
    // Distinct from the generic refusal it specialises.
    expect(message).not.toBe(CONNECT_REFUSAL_MESSAGES.second_source);
  });

  test("the absent, degraded, window, and completeness notices are pairwise distinct", () => {
    // "Nothing is attached" and "we looked and found nothing" are different answers; a
    // screen that shows them the same way is a bug.
    const notices = [
      SOURCE_ABSENT_NOTICE,
      SOURCE_DEGRADED_NOTICE,
      COUNTER_WINDOW_STATEMENT,
      COUNTER_COMPLETENESS_STATEMENT,
      CONNECTION_STATE_MESSAGES.connected_no_events_yet,
      CONNECTION_STATE_MESSAGES.not_connected,
    ];
    expect(new Set(notices).size).toBe(notices.length);
  });
});
