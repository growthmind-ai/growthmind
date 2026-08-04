// The preview's whole memory. It lives in one cookie so a dismissal on the list is still a
// dismissal when you land on the evidence, without a table existing yet.
export interface PreviewState {
  readonly dismissed: Readonly<Record<string, string>>;

  readonly fixes: readonly string[];

  readonly readOut: readonly string[];
}

export const EMPTY_PREVIEW_STATE: PreviewState = { dismissed: {}, fixes: [], readOut: [] };

export const PREVIEW_COOKIE = "gm_preview";

function asStringRecord(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

// Every shape this has ever been written in has to survive being read back, so nothing here
// trusts the cookie — a stale or hand-edited value degrades to empty rather than throwing.
export function decodePreviewState(raw: string | undefined): PreviewState {
  if (raw === undefined || raw.length === 0) return EMPTY_PREVIEW_STATE;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return EMPTY_PREVIEW_STATE;
  }

  if (typeof parsed !== "object" || parsed === null) return EMPTY_PREVIEW_STATE;

  const source = parsed as Record<string, unknown>;
  return {
    dismissed: asStringRecord(source.dismissed),
    fixes: asStringList(source.fixes),
    readOut: asStringList(source.readOut),
  };
}

export function encodePreviewState(state: PreviewState): string {
  return encodeURIComponent(JSON.stringify(state));
}

export function dismissFinding(state: PreviewState, id: string, reason: string): PreviewState {
  return { ...state, dismissed: { ...state.dismissed, [id]: reason } };
}

export function restoreFinding(state: PreviewState, id: string): PreviewState {
  const next: Record<string, string> = { ...state.dismissed };
  delete next[id];
  return { ...state, dismissed: next };
}

export function mintFix(state: PreviewState, findingId: string): PreviewState {
  if (state.fixes.includes(findingId)) return state;
  return { ...state, fixes: [...state.fixes, findingId] };
}

export function readOutVerdict(state: PreviewState, findingId: string): PreviewState {
  if (state.readOut.includes(findingId)) return state;
  return { ...state, readOut: [...state.readOut, findingId] };
}

export function isDismissed(state: PreviewState, id: string): boolean {
  return Object.hasOwn(state.dismissed, id);
}

export function hasFix(state: PreviewState, findingId: string): boolean {
  return state.fixes.includes(findingId);
}

export function isReadOut(state: PreviewState, findingId: string): boolean {
  return state.readOut.includes(findingId);
}
