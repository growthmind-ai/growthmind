"use client";

import { Button, Collapse, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";

import {
  ONBOARDING_MESSAGES,
  type FieldDescriptor,
  type StepView,
  type WorkStep,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";

import { FIRST_RUN_API, postJson, readRefusal, type ResponseRefusal } from "./api";
import { initialValues, offendingField, withSecretsCleared, type FieldValues } from "./form-fields";

const PROJECT_NUMBER = "projectNumber";
const PERSONAL_KEY = "personalKey";
const REGION_ADDRESS = "regionAddress";

interface ConnectAnalyticsFormProps {
  readonly step: WorkStep;
  readonly view: StepView;

  readonly connectionMessage: string;
}

export function ConnectAnalyticsForm(props: ConnectAnalyticsFormProps) {
  const { step, view, connectionMessage } = props;
  const router = useRouter();

  const [values, setValues] = useState<FieldValues>(() => initialValues(step.fields));
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<ResponseRefusal | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const attached = view.state === "done";
  const locked = pending || !view.interactive;
  const offender = offendingField(step.fields, refusal === null ? null : refusal.code);

  const expanded = unfolded || (offender !== null && offender.folded);

  function rememberInput(id: string) {
    return (node: HTMLInputElement | null) => {
      inputs.current[id] = node;
    };
  }

  function changeField(id: string) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.currentTarget.value;
      setValues((current) => ({ ...current, [id]: next }));
    };
  }

  function renderField(field: FieldDescriptor): ReactNode {
    const shared = {
      label: field.label,
      description: field.helper,
      placeholder: field.placeholder ?? undefined,
      value: values[field.id] ?? "",
      onChange: changeField(field.id),
      disabled: locked,
      error: offender?.id === field.id ? refusal?.message : undefined,
    };

    return field.secret ? (
      <PasswordInput key={field.id} ref={rememberInput(field.id)} {...shared} />
    ) : (
      <TextInput key={field.id} ref={rememberInput(field.id)} {...shared} />
    );
  }

  function refuse(answer: ResponseRefusal) {
    setRefusal(answer);
    setValues((current) => withSecretsCleared(current, step.fields));

    const target = offendingField(step.fields, answer.code);
    if (target === null) {
      return;
    }

    requestAnimationFrame(() => inputs.current[target.id]?.focus());
  }

  async function connect() {
    setPending(true);
    setRefusal(null);
    setFailure(null);
    setNotice(null);

    const answer = await postJson(FIRST_RUN_API.analyticsConnect, {
      host: values[REGION_ADDRESS] ?? "",
      sourceProjectId: values[PROJECT_NUMBER] ?? "",
      personalApiKey: values[PERSONAL_KEY] ?? "",
    });
    setPending(false);

    if (answer === null) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }
    if (answer.ok) {
      router.refresh();
      return;
    }

    const found = readRefusal(answer.body);
    if (found === null) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }
    refuse(found);
  }

  async function disconnect() {
    setPending(true);
    setRefusal(null);
    setFailure(null);

    const answer = await postJson(FIRST_RUN_API.analyticsDisconnect, {});
    setPending(false);

    if (answer === null || !answer.ok) {
      setFailure(readRefusal(answer?.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    setNotice(ONBOARDING_MESSAGES.disconnectConfirmation);
    router.refresh();
  }

  const visible = step.fields.filter((field) => !field.folded);
  const folded = step.fields.filter((field) => field.folded);

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {connectionMessage}
      </Text>

      {attached ? null : (
        <Stack gap="sm">
          {visible.map((field) => renderField(field))}

          {folded.map((field) => (
            <Stack key={field.id} gap={4}>
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                onClick={() => setUnfolded((open) => !open)}
                style={tapTargetStyle}
              >
                {field.disclosure}
              </Button>
              <Collapse expanded={expanded}>{renderField(field)}</Collapse>
            </Stack>
          ))}

          <Button
            onClick={() => void connect()}
            loading={pending}
            disabled={locked}
            style={tapTargetStyle}
            w={{ base: "100%", xs: "auto" }}
          >
            {pending ? ONBOARDING_MESSAGES.connecting : ONBOARDING_MESSAGES.connect}
          </Button>
        </Stack>
      )}

      {refusal === null || offender !== null ? null : (
        <Text size="sm" c="stamp.4">
          {refusal.message}
        </Text>
      )}

      {failure === null ? null : (
        <Text size="sm" c="stamp.4">
          {failure}
        </Text>
      )}

      {notice === null ? null : (
        <Text size="sm" c="dimmed">
          {notice}
        </Text>
      )}

      {attached && view.interactive ? (
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          onClick={() => void disconnect()}
          loading={pending}
          disabled={locked}
          style={tapTargetStyle}
          w={{ base: "100%", xs: "auto" }}
        >
          {ONBOARDING_MESSAGES.disconnect}
        </Button>
      ) : null}
    </Stack>
  );
}
