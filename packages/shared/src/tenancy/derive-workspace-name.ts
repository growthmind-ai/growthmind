export function deriveWorkspaceName(name: string | null | undefined): string {
  const trimmed = name?.trim();

  if (!trimmed) {
    return "Your workspace";
  }

  const [firstWord] = trimmed.split(/\s+/);

  return `${firstWord}'s workspace`;
}
