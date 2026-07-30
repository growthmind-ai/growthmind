// The exclusion classifier (O-003 D-9) and its versioned rule sets.
//
// `classifyExclusion` is PURE: no I/O, no clock, no randomness (FR-14 iii).
// Every input it reads is persisted on the session row, so a stored stamp is
// reproducible with zero PostHog access — the whole property the future
// `exclusions.backfill` depends on.
//
// TYPED STUB (O-003 scaffold): the rule sets and constants below are REAL and
// final; `classifyExclusion`'s signature is final and its body throws.
import { CODING_AGENT_TOKENS, HEADLESS_TOKENS, KNOWN_AGENT_TOKENS } from "./automation";
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
export function classifyExclusion(_facts: SessionFacts, _rules: ExclusionRuleSet): ExclusionReason {
  throw new Error("TYPED STUB (O-003 scaffold): classifyExclusion");
}
