import { UNKNOWN_TAG_NAME, isUnknownIdentity } from "./nodes";
import type { ElementIdentity } from "./types";

// The one precedence statement: a description is `tag` + every class + `#id`, and
// only when the element carries neither a class nor an id does it fall back to the
// first attribute named here. Attributes survive masking; text content does not.
export const DESCRIBE_ATTRIBUTE_PRECEDENCE: readonly string[] = [
  "data-testid",
  "name",
  "aria-label",
  "placeholder",
  "href",
  "type",
  "role",
  "alt",
  "title",
];

export const DESCRIBE_MAX_CLASSES = 3;

export const DESCRIBE_VALUE_MAX_LENGTH = 40;

export const DESCRIBE_TRUNCATION_MARKER = "…";

const WHITESPACE_RUN = /\s+/g;

function readableValue(value: string): string {
  const collapsed = value.replaceAll(WHITESPACE_RUN, " ").trim();
  if (collapsed.length <= DESCRIBE_VALUE_MAX_LENGTH) return collapsed;

  const head = Math.max(0, DESCRIBE_VALUE_MAX_LENGTH - DESCRIBE_TRUNCATION_MARKER.length);
  return `${collapsed.slice(0, head).trimEnd()}${DESCRIBE_TRUNCATION_MARKER}`;
}

function attributeSuffix(identity: ElementIdentity): string {
  for (const name of DESCRIBE_ATTRIBUTE_PRECEDENCE) {
    const value = identity.attributes[name];
    if (value === undefined) continue;

    const readable = readableValue(value);
    if (readable.length > 0) return `[${name}=${readable}]`;
  }
  return "";
}

export function describeElement(identity: ElementIdentity): string {
  if (isUnknownIdentity(identity)) {
    return `${UNKNOWN_TAG_NAME}(${String(identity.nodeId)})`;
  }

  const classes = identity.classes
    .slice(0, DESCRIBE_MAX_CLASSES)
    .map((entry) => `.${readableValue(entry)}`)
    .join("");
  const id = identity.id === undefined ? "" : `#${readableValue(identity.id)}`;

  const distinguished = `${identity.tagName}${classes}${id}`;
  if (classes.length > 0 || id.length > 0) return distinguished;

  return `${distinguished}${attributeSuffix(identity)}`;
}
