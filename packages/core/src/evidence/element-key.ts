import { isUnknownIdentity } from "../replay/nodes";
import type { ElementIdentity } from "../replay/types";

export type ElementKeyTier = "stable" | "structural";

export type ElementKey = {
  readonly key: string;
  readonly tier: ElementKeyTier;
};

// testId, id and role are free-form attribute values, so the field separator must be a
// character none of them can carry; class tokens are whitespace-split upstream.
const FIELD_SEPARATOR = "\u0000";
const CLASS_SEPARATOR = " ";

export function isStructurallyAnonymous(identity: ElementIdentity): boolean {
  return (
    identity.testId === undefined && identity.id === undefined && identity.classes.length === 0
  );
}

function joinKey(parts: readonly string[]): string {
  return parts.join(FIELD_SEPARATOR);
}

function structuralKey(identity: ElementIdentity): string {
  const classes = identity.classes.toSorted().join(CLASS_SEPARATOR);
  return joinKey(["structural", identity.tagName, identity.role ?? "", classes]);
}

export function stableElementKey(identity: ElementIdentity): ElementKey | null {
  if (isUnknownIdentity(identity)) return null;
  if (isStructurallyAnonymous(identity)) return null;

  if (identity.testId !== undefined) {
    return { key: joinKey(["stable", "testid", identity.testId]), tier: "stable" };
  }

  if (identity.id !== undefined) {
    return { key: joinKey(["stable", "id", identity.id]), tier: "stable" };
  }

  return { key: structuralKey(identity), tier: "structural" };
}
