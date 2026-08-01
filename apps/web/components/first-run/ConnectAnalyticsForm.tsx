"use client";

// STEP 2 — THE ONE CONNECTION THE PRODUCT CANNOT WORK WITHOUT
// (O-008, FR-O5, FR-O6, UX Checklist rows 5-8 and Flows C and F).
//
// ###########################################################################
// # THE FIELDS ARE DATA; THE ACTIONS ARE NOT.
// #
// # Every field on this form — its label, its helper, whether it is masked,
// # whether it starts folded, what it is prefilled with, and WHICH REFUSALS IT
// # IS THE SUBJECT OF — comes off the step descriptor. That last one is the
// # wire that makes UX rows 6 and 7 one mechanism instead of two: a refusal
// # names a code, the descriptor says which field that code is about, and this
// # form moves focus there and unfolds it if it was hidden. A refusal naming a
// # field the founder cannot see is a dead end.
// #
// # The two ACTIONS are wired here rather than read off the descriptor,
// # because an action is a handler and a handler cannot be data. Their labels
// # still come from the one copy home.
// #
// # PROGRESS HAS ONE LOCUS: the button, with a verb on it. No spinner overlay,
// # no skeleton, no second signal anywhere on the row (T2).
// #
// # AND A REJECTED SECRET IS NEVER RE-SUBMITTED SILENTLY. On any refusal every
// # masked field is cleared and every visible value is preserved, so the
// # founder retypes only the thing that was wrong.
// ###########################################################################
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

/**
 * The three field ids, named once.
 *
 * The route's body uses the vendor's own vocabulary (`host`, `sourceProjectId`,
 * `personalApiKey`) and the form uses the founder's ("Region address",
 * "Project number"). The mapping between them is the kind of thing that rots
 * quietly, so it is written in one place and read from constants.
 */
const PROJECT_NUMBER = "projectNumber";
const PERSONAL_KEY = "personalKey";
const REGION_ADDRESS = "regionAddress";

interface ConnectAnalyticsFormProps {
  readonly step: WorkStep;
  readonly view: StepView;
  /** The shipped sentence for this connection's state. Never authored here. */
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

  // UX row 7: the region disclosure AUTO-EXPANDS when the refusal is about the
  // region. Derived rather than pushed into state, so the frame that first
  // renders the sentence is already the frame that shows the field it names —
  // there is no window in which the founder is told to check something they
  // cannot see.
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
    // Deferred by one frame so the focus lands AFTER the disclosure above has
    // expanded. A folded field is hidden, and a hidden element cannot take
    // focus — the sequence has to be expand, then focus, in that order.
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
      // The step's new state is a PERSISTED fact, so it is re-read rather than
      // guessed at here — a reload has to land on the same screen (D4).
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

    // Org-wide, and it says so. A teammate pressing this must not find out
    // afterwards that they revoked it for everybody (UX Checklist row 28).
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
