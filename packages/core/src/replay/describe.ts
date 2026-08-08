import { deliverableName, deliverableValue, readableValue } from "./describe-value";
import { UNKNOWN_TAG_NAME, isUnknownIdentity } from "./nodes";
import type { ElementIdentity } from "./types";

export {
  DESCRIBE_IDENTIFIER_VALUE,
  DESCRIBE_TRUNCATION_MARKER,
  DESCRIBE_VALUE_MAX_LENGTH,
} from "./describe-value";

export type SemanticSource =
  { readonly from: "attribute"; readonly name: string } | { readonly from: "accessibleName" };

// The one precedence statement: a description leads with the first of these to survive the value
// gate, and falls back to `tag` + every class + `#id` only when none does. The name a person
// reads is outranked only by a handle a developer wrote onto this one element.
export const DESCRIBE_SEMANTIC_PRECEDENCE: readonly SemanticSource[] = [
  { from: "attribute", name: "data-testid" },
  { from: "attribute", name: "name" },
  { from: "attribute", name: "aria-label" },
  { from: "accessibleName" },
  { from: "attribute", name: "autocomplete" },
  { from: "attribute", name: "placeholder" },
  { from: "attribute", name: "href" },
  { from: "attribute", name: "type" },
  { from: "attribute", name: "role" },
  { from: "attribute", name: "alt" },
  { from: "attribute", name: "title" },
];

export const DESCRIBE_ATTRIBUTE_PRECEDENCE: readonly string[] = DESCRIBE_SEMANTIC_PRECEDENCE.filter(
  (source): source is { readonly from: "attribute"; readonly name: string } =>
    source.from === "attribute",
).map((source) => source.name);

export const DESCRIBE_NAME_LABEL = "label";

export const DESCRIBE_MAX_CLASSES = 3;

// Which element authored a name is known at capture and gone by here, so the name keeps the wider
// gate and every attribute keeps the narrow one.
function semanticValue(identity: ElementIdentity, source: SemanticSource): string | null {
  if (source.from === "accessibleName") {
    return identity.accessibleName === undefined ? null : deliverableName(identity.accessibleName);
  }

  const value = identity.attributes[source.name];
  return value === undefined ? null : deliverableValue(value);
}

function semanticDescriptor(identity: ElementIdentity): string {
  for (const source of DESCRIBE_SEMANTIC_PRECEDENCE) {
    const value = semanticValue(identity, source);
    if (value === null) continue;

    const label = source.from === "accessibleName" ? DESCRIBE_NAME_LABEL : source.name;
    return `[${label}=${value}]`;
  }
  return "";
}

// Two controls can carry the same name, so one handle follows it: the id, or failing that the
// first class. One token, because leading with meaning buys nothing if the hash comes back.
function disambiguatingTail(identity: ElementIdentity): string {
  if (identity.id !== undefined) return `#${readableValue(identity.id)}`;

  const first = identity.classes[0];
  return first === undefined ? "" : `.${readableValue(first)}`;
}

export function describeElement(identity: ElementIdentity): string {
  if (isUnknownIdentity(identity)) {
    return `${UNKNOWN_TAG_NAME}(${String(identity.nodeId)})`;
  }

  const semantic = semanticDescriptor(identity);
  if (semantic.length > 0) {
    return `${identity.tagName}${semantic}${disambiguatingTail(identity)}`;
  }

  const classes = identity.classes
    .slice(0, DESCRIBE_MAX_CLASSES)
    .map((entry) => `.${readableValue(entry)}`)
    .join("");
  const id = identity.id === undefined ? "" : `#${readableValue(identity.id)}`;

  return `${identity.tagName}${classes}${id}`;
}
