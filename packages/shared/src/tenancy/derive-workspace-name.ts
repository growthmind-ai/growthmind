/**
 * OQ-1 rule: the first word of the trimmed user name, possessive ("Ada's workspace");
 * falls back to "Your workspace" when the name is empty, whitespace-only, or missing.
 * No email-domain inference (the free-mail trap the prd flags). Pure; output is never
 * empty and never contains the literal string "undefined".
 *
 * Implemented in a later wave against the test names in
 * `packages/shared/__tests__/tenancy/derive-workspace-name.test.ts`.
 */
export function deriveWorkspaceName(name: string | null | undefined): string {
  const trimmed = name?.trim();

  if (!trimmed) {
    return "Your workspace";
  }

  const [firstWord] = trimmed.split(/\s+/);

  return `${firstWord}'s workspace`;
}
