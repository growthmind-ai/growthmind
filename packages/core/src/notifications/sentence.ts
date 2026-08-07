import type { FindingText } from "../delivery/finding-text";

// One pure builder per type; web (bell rows) and worker (Slack render) call the same
// function — same sentence, different chrome.

export interface KeysRevokedSentenceInput {
  readonly workspaceName: string;

  // Null when the actor cannot be resolved; the unknown-revoker fallback lives inside
  // the builder — one home (ADD §3).
  readonly revokedByName: string | null;
}

// buildAgentRevokeAnnouncement's fallback, byte for byte — the bespoke module retires
// in this sprint and this is where its copy now lives.
const UNKNOWN_REVOKER = "Someone in this workspace";

// PRD FR-4's draft, PROPOSED pending Tom's sign-off.
const FIRST_CONTACT_SENTENCE = "A coding assistant connected to this workspace for the first time.";

const GENERIC_SENTENCE = "Growthmind has an update for you — open it to see the details.";

// A held text renders the generic sentence + link: this builder must not become a second
// unscanned reader path.
export function findingDeliveredSentence(text: FindingText): string {
  return text.held ? genericNotificationSentence() : text.headline;
}

export function keysRevokedSentence(input: KeysRevokedSentenceInput): string {
  const who = input.revokedByName ?? UNKNOWN_REVOKER;

  return (
    `${who} revoked every key for ${input.workspaceName}. Anything that was calling us with ` +
    `one of those keys has stopped — reconnect it with a new key when you're ready.`
  );
}

export function agentFirstContactSentence(): string {
  return FIRST_CONTACT_SENTENCE;
}

export function genericNotificationSentence(): string {
  return GENERIC_SENTENCE;
}
