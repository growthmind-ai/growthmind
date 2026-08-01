// The exclusion classifier and its versioned rule sets.
//
// `classifyExclusion` is pure: no I/O, no clock, no randomness (iii). Every input it
// reads is persisted on the session row, so a stored stamp is reproducible with zero
// PostHog access. The whole property the future `exclusions.backfill` depends on.
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
 * `EXCLUSION_RULE_SETS.get` still reproduces a v1 stamp exactly, so a rule change is
 * a detectable and migratable event rather than a silent fork of every stamp on record.
 */
export const EXCLUSION_RULE_SETS: ReadonlyMap<number, ExclusionRuleSet> = new Map([
  [1, RULE_SET_V1],
]);

/** The rule set `EXCLUSION_RULE_SET_VERSION` names. */
export const CURRENT_EXCLUSION_RULE_SET: ExclusionRuleSet = RULE_SET_V1;

/**
 * Classifies one assembled session. Total by type, every session gets a reason, and
 * `"none"` means "classified and kept", never "not classified".
 *
 * Evaluation order and fail directions, each asserted by a named test:
 *
 * 1. **Headless / E2E**. Confident exclude. Checked first because it
 *  is the one class we are willing to be wrong about in the excluding
 *  direction.
 * 2. **Known agent**, whole-token match only; anything ambiguous is
 *  INCLUDED as real.
 * 3. **Coding agent**, same direction as F-5, named separately so the
 *  counter can explain the gap in the customer's own terms.
 * 4. **Absent user agent**, `null` or `""` classifies as `"none"`,
 *  never as automation. Sec-a: PostHog does not derive a UA server-side.
 * 5. **Internal domain**, fail open. `identityEmailDomain === null` is
 *  the majority path (row 6: `person` is null on every event), and it
 *  yields `"none"`. Matching is exact: `acme.com.co` and `sub.acme.com` do
 *  Not match `acme.com`. Over-exclusion is invisible and erases the
 *  evidence a finding rests on; under-exclusion is visible and cheaply
 *  re-marked by the later backfill. Asymmetric ⇒ fail open.
 *
 * `facts.identityResolution === "unresolved"` never changes the reason. An unresolved
 * session is kept and counted separately as `keptIdentityUnverified` by the
 * counter, so "we could not check" is never laundered into "we checked and it is a real
 * user".
 *
 * F-9 (host-based staging/preview exclusion) is deliberately not built. There is no
 * sixth predicate here, and no host/domain-pattern rule anywhere in `src/exclusions/`:
 * a real early-stage product's production host genuinely is `something.vercel.app`, so
 * any such predicate fires on a superset of its target by construction (the conflation
 * this sprint exists to prevent), and there is no reliable signal in `SessionFacts` to
 * tell "this is staging" from "this is how this customer ships". The absence is stated
 * here, not silently assumed, and enforced by a grep test
 * (`__tests__/exclusions/automation.test.ts`) asserting no host, staging, or preview
 * predicate, literal, or reason ever lands in this module.
 */
export function classifyExclusion(facts: SessionFacts, rules: ExclusionRuleSet): ExclusionReason {
  const userAgent = facts.userAgent?.trim() ?? "";

  // Fail direction: an absent or empty user agent is a real person until proven
  // otherwise. Sec-a pinned that no user agent is derived server-side, so a server-side
  // or minimal SDK integration sends none at all. Treating that as automation would
  // silently drop every such session.
  if (userAgent.length > 0) {
    // Fail direction: confident exclude. The one named exception, and checked
    // first because it is the only class we accept being wrong about in the excluding
    // direction. A real human is essentially never on a headless browser or an
    // end-to-end driver, and unfiltered test traffic wrecks an activation funnel
    // outright.
    if (firesAny(userAgent, rules.headlessTokens)) return "automation_headless";

    // Fail direction: toward including as real. Whole-token matches against a
    // narrow, high-precision list only. Anything ambiguous is kept: a broad heuristic
    // here is the superset failure with a friendly name, and over-exclusion is
    // invisible while under-exclusion is not.
    if (firesAny(userAgent, rules.knownAgentTokens)) return "automation_known_agent";

    // Fail direction: same as F-5. Named as its own class so the counter's
    // breakdown can explain the gap in the customer's own terms rather than lumping
    // their coding agent in with crawlers.
    if (firesAny(userAgent, rules.codingAgentTokens)) return "automation_coding_agent";
  }

  // Fail direction: Fail open. `identityEmailDomain === null` is the majority
  // path, not an edge case. Row 6 pinned that no email reaches us on the event at all,
  // and it yields "none". A project with no inferred domain yields "none" as well:
  // nothing may be matched against a domain we never established. Over-exclusion is
  // invisible and erases the evidence a finding rests on; under-exclusion is visible
  // and cheaply re-marked by the later backfill. Asymmetric ⇒ fail open.
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

  // Fail direction: `facts.identityResolution` is deliberately not read above.
  // "We could not check" is kept as real and reported separately by the counter as
  // `keptIdentityUnverified`; it is never laundered into "we checked and this is our
  // own team".
  return "none";
}

function firesAny(userAgent: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => matchesToken(userAgent, token));
}
