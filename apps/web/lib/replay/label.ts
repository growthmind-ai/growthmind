const MAX_LABEL_CHARS = 72;

export interface RecordingLabel {
  readonly text: string;
  readonly source: string | null;
}

export interface TimeOnPage {
  readonly badge: string;
  readonly total: string | null;
}

function duration(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const minutes = Math.floor(value / 60);
  return minutes > 0 ? `${minutes}m ${Math.round(value % 60)}s` : `${Math.round(value)}s`;
}

// `total` comes back only when it says something the badge does not: absent when there is
// no active time to compare it against, and absent when a session was active throughout.
export function timeOnPage(meta: Record<string, unknown>): TimeOnPage | null {
  const total = duration(meta.recording_duration);
  const active = duration(meta.active_seconds);

  if (active === null) {
    return total === null ? null : { badge: total, total: null };
  }

  return { badge: `${active} active`, total: total === active ? null : total };
}

function truncate(value: string): string {
  return value.length <= MAX_LABEL_CHARS ? value : `${value.slice(0, MAX_LABEL_CHARS - 1)}…`;
}

function pathOf(url: URL): string {
  return url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
}

// utm_source rather than the whole query string: the query answers "where did they come
// from", the path answers "what did they look at", and smashing both onto one line is what
// made a share token 71 characters wide push the timestamp off the row. The dropped part is
// dropped rather than tooltipped — rrweb cannot mask an attribute, see lib/replay-masking.ts.
export function recordingLabel(startUrl: unknown, recordingId: string): RecordingLabel {
  if (typeof startUrl !== "string" || startUrl === "") {
    return { text: recordingId, source: null };
  }

  let url: URL;
  try {
    url = new URL(startUrl);
  } catch {
    return { text: truncate(startUrl), source: null };
  }

  const host = url.host.replace(/^www\./, "");
  const source = url.searchParams.get("utm_source");

  return {
    text: truncate(`${host}${pathOf(url)}`),
    source: source === null || source === "" ? null : source,
  };
}
