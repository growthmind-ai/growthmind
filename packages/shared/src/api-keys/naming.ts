export interface ApiKeyNameInput {
  readonly requested: string | null;
  readonly label: string | null;
  readonly now: Date;
}

export const API_KEY_DEFAULT_LABEL = "read credential";

// `now` is a parameter so the name is a pure function of its inputs; nothing
// here may read the clock.
export function apiKeyNameFor(input: ApiKeyNameInput): string {
  const requested = input.requested?.trim() ?? "";
  if (requested.length > 0) return requested;

  const label = input.label?.trim() ?? "";
  const day = input.now.toISOString().slice(0, 10);

  return `${label.length > 0 ? label : API_KEY_DEFAULT_LABEL} (${day})`;
}
