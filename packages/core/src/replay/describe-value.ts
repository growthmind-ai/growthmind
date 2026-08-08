import { isCleanForDelivery } from "../delivery/residual-pii";

export const DESCRIBE_VALUE_MAX_LENGTH = 40;

// Two caps for two kinds of thing: 40 bounds a selector-shaped value, this bounds a sentence a
// screen showed, and only this one keeps its front. See .ai/decisions/0026-reaction-text-cap.md
export const DESCRIBE_SENTENCE_MAX_LENGTH = 160;

export const DESCRIBE_TRUNCATION_MARKER = "…";

// One developer-authored token, because a live DOM's attributes carry a person's data (B-052).
export const DESCRIBE_IDENTIFIER_VALUE = /^[A-Za-z0-9._~:/?#=&%+-]+$/;

const WHITESPACE_RUN = /\s+/g;

const ABSOLUTE_URL = /^[a-z][\w+.-]*:\/\/([^/?#\s]*)(\S*)$/i;

// Every link on a site shares its origin, so a long one crowds out the path that tells two apart.
function withoutOrigin(value: string): string {
  const parsed = ABSOLUTE_URL.exec(value);
  if (parsed === null) return value;

  const host = parsed[1] ?? "";
  const path = parsed[2] ?? "";
  return path.length === 0 || path === "/" ? host : path;
}

export function collapse(value: string): string {
  return withoutOrigin(value.replaceAll(WHITESPACE_RUN, " ").trim());
}

// rrweb's mask is `replace(/[\S]/g, "*")`, so a run of these is text the recorder withheld.
export function isMaskedText(value: string): boolean {
  const visible = value.replaceAll(WHITESPACE_RUN, "");
  return visible.length > 0 && [...visible].every((character) => character === "*");
}

export function truncate(value: string): string {
  if (value.length <= DESCRIBE_VALUE_MAX_LENGTH) return value;

  // Keep the tail: two values long enough to truncate usually differ at the end.
  const tail = Math.max(0, DESCRIBE_VALUE_MAX_LENGTH - DESCRIBE_TRUNCATION_MARKER.length);
  return `${DESCRIBE_TRUNCATION_MARKER}${value.slice(-tail).trimStart()}`;
}

export function truncateSentence(value: string): string {
  if (value.length <= DESCRIBE_SENTENCE_MAX_LENGTH) return value;

  const head = Math.max(0, DESCRIBE_SENTENCE_MAX_LENGTH - DESCRIBE_TRUNCATION_MARKER.length);
  return `${value.slice(0, head).trimEnd()}${DESCRIBE_TRUNCATION_MARKER}`;
}

export function readableValue(value: string): string {
  return truncate(collapse(value));
}

// Both gates read the whole value: truncating first leaves a token-shaped tail of a refused one.
export function deliverableValue(value: string): string | null {
  const collapsed = collapse(value);
  if (collapsed.length === 0) return null;
  if (!DESCRIBE_IDENTIFIER_VALUE.test(collapsed)) return null;
  if (!isCleanForDelivery(collapsed)) return null;

  return truncate(collapsed);
}

// Drops the token shape by ruling, for text a <button> or <label> authored and nothing else. The
// asymmetry with deliverableValue is deliberate: .ai/decisions/0025-multi-word-accessible-names.md
export function deliverableName(value: string): string | null {
  const collapsed = collapse(value);
  if (collapsed.length === 0 || isMaskedText(collapsed)) return null;
  if (!isCleanForDelivery(collapsed)) return null;

  return truncate(collapsed);
}

export function deliverableSentence(value: string): string | null {
  const collapsed = collapse(value);
  if (collapsed.length === 0 || isMaskedText(collapsed)) return null;
  if (!isCleanForDelivery(collapsed)) return null;

  return truncateSentence(collapsed);
}
