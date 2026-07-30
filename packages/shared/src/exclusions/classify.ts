// The exclusion classifier (O-003 D-9) and its versioned rule sets.
//
// `classifyExclusion` is PURE: no I/O, no clock, no randomness (FR-14 iii).
// Every input it reads is persisted on the session row, so a stored stamp is
// reproducible with zero PostHog access — the whole property the future
// `exclusions.backfill` depends on.
//
// Implemented in Wave 1 against the scaffold's final signatures.
import {
  CODING_AGENT_TOKENS,
  HEADLESS_TOKENS,
  KNOWN_AGENT_TOKENS,
  matchesToken,
} from "./automation";
import { FREE_MAIL_DOMAINS } from "./free-mail";
import type { ExclusionReason, ExclusionRuleSet, SessionFacts } from "./types";

/** The rule set new stamps are written under. */
export const EXCLUSION_RULE_SET_VERSION = 1;

const RULE_SET_V1: ExclusionRuleSet = {
  version: 1,
  freeMailDomains: FREE_MAIL_DOMAINS,
  headlessTokens: HEADLESS_TOKENS,
  knownAgentTokens: KNOWN_AGENT_TOKENS,
  codingAgentTokens: CODING_AGENT_TOKENS,
};

/**
 * Every rule set ever shipped, keyed by version. When v2 lands,
 * `EXCLUSION_RULE_SETS.get(1)` still reproduces a v1 stamp exactly, so a rule
 * change is a detectable and migratable event rather than a silent D12 fork
 * of every stamp on record.
 */
export const EXCLUSION_RULE_SETS: ReadonlyMap<number, ExclusionRuleSet> = new Map([
  [1, RULE_SET_V1],
]);

/** The rule set `EXCLUSION_RULE_SET_VERSION` names. */
export const CURRENT_EXCLUSION_RULE_SET: ExclusionRuleSet = RULE_SET_V1;

/**
 * Classifies one assembled session. Total by type — every session gets a
 * reason, and `"none"` means "classified and kept", never "not classified".
 *
 * Evaluation order and fail directions, each asserted by a named test:
 *
 * 1. **Headless / E2E (F-4)** — confident EXCLUDE. Checked first because it
 *    is the one class we are willing to be wrong about in the excluding
 *    direction.
 * 2. **Known agent (F-5)** — whole-token match only; anything ambiguous is
 *    INCLUDED as real.
 * 3. **Coding agent (F-6)** — same direction as F-5, named separately so the
 *    counter can explain the gap in the customer's own terms.
 * 4. **Absent user agent (F-7)** — `null` or `""` classifies as `"none"`,
 *    never as automation. SEC-A: PostHog does not derive a UA server-side.
 * 5. **Internal domain (F-3)** — FAIL OPEN. `identityEmailDomain === null` is
 *    the MAJORITY path (ROW 6: `person` is null on every event), and it
 *    yields `"none"`. Matching is EXACT: `acme.com.co` and `sub.acme.com` do
 *    NOT match `acme.com`. Over-exclusion is invisible and erases the
 *    evidence a finding rests on; under-exclusion is visible and cheaply
 *    re-marked by the later backfill. Asymmetric ⇒ fail open.
 *
 * `facts.identityResolution === "unresolved"` never changes the reason — an
 * unresolved session is KEPT (F-8) and counted separately as
 * `keptIdentityUnverified` by the counter, so "we could not check" is never
 * laundered into "we checked and it is a real user".
 */
export function classifyExclusion(facts: SessionFacts, rules: ExclusionRuleSet): ExclusionReason {
  const userAgent = facts.userAgent?.trim() ?? "";

  // FAIL DIRECTION (F-7): an absent or empty user agent is a real person until
  // proven otherwise. SEC-A pinned that no user agent is derived server-side,
  // so a server-side or minimal SDK integration sends none at all — treating
  // that as automation would silently drop every such session.
  if (userAgent.length > 0) {
    // FAIL DIRECTION (F-4): confident EXCLUDE — the one named exception, and
    // checked first because it is the only class we accept being wrong about
    // in the excluding direction. A real human is essentially never on a
    // headless browser or an end-to-end driver, and unfiltered test traffic
    // wrecks an activation funnel outright.
    if (firesAny(userAgent, rules.headlessTokens)) return "automation_headless";

    // FAIL DIRECTION (F-5): toward INCLUDING as real. Whole-token matches
    // against a narrow, high-precision list only. Anything ambiguous is kept:
    // a broad heuristic here is the superset failure with a friendly name,
    // and over-exclusion is invisible while under-exclusion is not.
    if (firesAny(userAgent, rules.knownAgentTokens)) return "automation_known_agent";

    // FAIL DIRECTION (F-6): same as F-5. Named as its own class so the
    // counter's breakdown can explain the gap in the customer's own terms
    // rather than lumping their coding agent in with crawlers.
    if (firesAny(userAgent, rules.codingAgentTokens)) return "automation_coding_agent";
  }

  // FAIL DIRECTION (F-3): FAIL OPEN. `identityEmailDomain === null` is the
  // MAJORITY path, not an edge case — ROW 6 pinned that no email reaches us on
  // the event at all — and it yields "none". A project with no inferred domain
  // yields "none" as well: nothing may be matched against a domain we never
  // established. Over-exclusion is invisible and erases the evidence a finding
  // rests on; under-exclusion is visible and cheaply re-marked by the later
  // backfill. Asymmetric ⇒ fail open.
  //
  // Matching is whole-domain equality and nothing else. A suffix rule fires on
  // `acme.com.co`; a subdomain rule fires on `acme.com.attacker.net`.
  const internalDomain = facts.internalDomain?.trim().toLowerCase() ?? "";
  const identityEmailDomain = facts.identityEmailDomain?.trim().toLowerCase() ?? "";
  if (
    internalDomain.length > 0 &&
    identityEmailDomain.length > 0 &&
    identityEmailDomain === internalDomain
  ) {
    return "internal_domain";
  }

  // FAIL DIRECTION (F-8): `facts.identityResolution` is deliberately NOT read
  // above. "We could not check" is kept as real and reported separately by the
  // counter as `keptIdentityUnverified`; it is never laundered into "we
  // checked and this is our own team".
  return "none";
}

function firesAny(userAgent: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => matchesToken(userAgent, token));
}
