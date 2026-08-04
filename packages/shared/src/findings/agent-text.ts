import type { EvidenceView } from "./view";

// The same evidence a founder reads, as text their coding agent can be handed directly.
// One artefact, two audiences, no second rendering to keep in step with the first.
export function evidenceForAgent(evidence: EvidenceView): string {
  const parts: string[] = [evidence.headline, evidence.countLine, ""];

  if (evidence.claims.length > 0) {
    parts.push("What we think happened:");
    for (const claim of evidence.claims) {
      parts.push(`- ${claim.statement} (${claim.citesLabel})`);
    }
    parts.push("");
  }

  if (evidence.beats.length > 0) {
    parts.push("One person's session:");
    for (const beat of evidence.beats) {
      const attempt = beat.attempt === null ? "" : `  [attempt ${String(beat.attempt)}]`;
      parts.push(`${beat.at}  ${beat.text}${attempt}`);
    }
    parts.push("");
  }

  if (evidence.cohortLine !== null) {
    parts.push(evidence.cohortLine, "");
  }

  parts.push(evidence.coverageLine);

  return parts.join("\n");
}
