import type { FindingText } from "../delivery/finding-text";

// One pure builder per type; web (bell rows) and worker (Slack render) call the same
// function — same sentence, different chrome.

export interface KeysRevokedSentenceInput {
  readonly workspaceName: string;

  // Null when the actor cannot be resolved; the unknown-revoker fallback lives inside
  // the builder — one home (ADD §3).
  readonly revokedByName: string | null;
}

// A held text renders the generic sentence + link: this builder must not become a second
// unscanned reader path.
export function findingDeliveredSentence(_text: FindingText): string {
  throw new Error("O-051 W1+: not implemented");
}

export function keysRevokedSentence(_input: KeysRevokedSentenceInput): string {
  throw new Error("O-051 W1+: not implemented");
}

export function agentFirstContactSentence(): string {
  throw new Error("O-051 W1+: not implemented");
}

export function genericNotificationSentence(): string {
  throw new Error("O-051 W1+: not implemented");
}
