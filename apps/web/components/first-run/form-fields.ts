// DESCRIPTOR-DRIVEN FORM STATE, SHARED BY THE TWO WORK STEPS (O-008, AD-19).
//
// Both connect forms are driven by their step descriptor's `fields` array
// rather than by hand-written inputs, so a label, a helper, a placeholder, a
// prefill, whether a value is masked and which refusals it is the subject of
// are all DATA. What differs between the two steps is which handler a button
// runs, and a handler cannot be data — so the actions stay in the components
// and everything below is shared.
//
// THIS FILE AUTHORS NO CUSTOMER-FACING STRING and renders nothing. It holds
// the three operations both forms would otherwise each own a copy of.
import type { FieldDescriptor } from "@growthmind/shared";

/** What the founder has typed, keyed by the descriptor's own field id. */
export type FieldValues = Record<string, string>;

/**
 * Prefilled where the descriptor says so, empty everywhere else.
 *
 * A VISIBLE field is never prefilled — a field the product can fill in for you
 * is a field it should not have asked for — so in practice this only fills the
 * one folded field, which is why step 2 needs no typing in the common case.
 */
export function initialValues(fields: readonly FieldDescriptor[]): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    values[field.id] = field.prefill ?? "";
  }
  return values;
}

/**
 * Every masked value dropped; everything the founder can still read, kept.
 *
 * A rejected secret is never re-submitted silently, and retyping the two
 * things that were fine is how a form loses somebody on their second attempt.
 */
export function withSecretsCleared(
  values: FieldValues,
  fields: readonly FieldDescriptor[],
): FieldValues {
  const next: FieldValues = { ...values };
  for (const field of fields) {
    if (field.secret) {
      next[field.id] = "";
    }
  }
  return next;
}

/**
 * The field a refusal is ABOUT, per the descriptor's own declaration.
 *
 * This is the wire that makes two checklist rows one mechanism: a refusal
 * carries a code, the descriptor says which field that code concerns, and the
 * form moves focus there and unfolds it if it was hidden. A refusal naming a
 * field the founder cannot see is a dead end.
 */
export function offendingField(
  fields: readonly FieldDescriptor[],
  code: string | null,
): FieldDescriptor | null {
  if (code === null) {
    return null;
  }
  return fields.find((field) => field.refusalCodes.some((known) => known === code)) ?? null;
}
