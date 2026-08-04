// Entries match a user id OR an email, because the same person has a different id in every
// database. Ids are stable in one environment; an email is stable across all of them.
export function parsePreviewAllowList(raw: string | undefined): ReadonlySet<string> {
  if (raw === undefined) return new Set();

  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

export interface PreviewViewer {
  readonly userId: string;
  readonly email: string | null;
}

// Absent list means nobody, never everybody. The failure this guards is a surface of
// invented findings rendering for a real customer.
export function isPreviewViewer(
  viewer: PreviewViewer | null,
  allowed: ReadonlySet<string>,
): boolean {
  if (viewer === null || allowed.size === 0) return false;

  if (allowed.has(viewer.userId.toLowerCase())) return true;

  const email = viewer.email?.trim().toLowerCase() ?? "";
  return email.length > 0 && allowed.has(email);
}
