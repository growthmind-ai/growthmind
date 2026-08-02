import type { FieldDescriptor } from "@growthmind/shared";

export type FieldValues = Record<string, string>;

export function initialValues(fields: readonly FieldDescriptor[]): FieldValues {
  const values: FieldValues = {};
  for (const field of fields) {
    values[field.id] = field.prefill ?? "";
  }
  return values;
}

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

export function offendingField(
  fields: readonly FieldDescriptor[],
  code: string | null,
): FieldDescriptor | null {
  if (code === null) {
    return null;
  }
  return fields.find((field) => field.refusalCodes.some((known) => known === code)) ?? null;
}
