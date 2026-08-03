"use client";

import { PasswordInput, TextInput } from "@mantine/core";
import type { ChangeEvent, Ref } from "react";

import type { FieldDescriptor } from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";

interface FieldRowProps {
  readonly field: FieldDescriptor;
  readonly value: string;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly disabled: boolean;

  // Present when a refusal names this field.
  readonly error?: string | undefined;

  // Present when the card moves focus to the field a refusal named.
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
}

export function FieldRow(props: FieldRowProps) {
  const field = props.field;

  const shared = {
    label: field.label,
    description: field.helper,
    placeholder: field.placeholder ?? undefined,
    value: props.value,
    onChange: props.onChange,
    disabled: props.disabled,
    error: props.error,
    ref: props.inputRef,
    style: tapTargetStyle,
  };

  return field.secret ? <PasswordInput {...shared} /> : <TextInput {...shared} />;
}
