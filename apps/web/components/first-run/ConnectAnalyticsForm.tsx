"use client";

// Step 2, and ONE VISIBLE FIELD: paste the key and press once, and we ask the
// vendor which projects it can read across both hosted regions. The self-host
// address field is earned (AD-2) — it appears only after both probes refuse.
// The fields are data off the step descriptor, including which refusal each is
// the subject of; on any refusal masked fields are cleared and visible kept.
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

import {
  FIRST_RUN_API,
  postJson,
  readDiscovery,
  readRefusal,
  type DiscoveredProjectView,
  type DiscoveryAnswer,
  type ResponseRefusal,
} from "./api";
import { initialValues, offendingField, withSecretsCleared, type FieldValues } from "./form-fields";

// The two field ids, named once. There is no third: the project number is
// discovered now, so the form never asks for one.
const PERSONAL_KEY = "personalKey";
const SELF_HOST_ADDRESS = "regionAddress";

interface AttachInput {
  // The address the walk settled on, never re-derived.
  readonly host: string;
  readonly project: DiscoveredProjectView;
  // `null` when the founder chose the project themselves.
  readonly announcement: string | null;
}

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
  // One value, so a host can never be paired with another walk's projects.
  const [discovery, setDiscovery] = useState<DiscoveryAnswer | null>(null);
  // Which option is attaching, so the spinner sits on the row that was pressed.
  const [choosing, setChoosing] = useState<string | null>(null);
  // Set the moment a region walk comes back refused. The whole of "earned".
  const [addressEarned, setAddressEarned] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const attached = view.state === "done";
  const locked = pending || !view.interactive;
  const offender = offendingField(step.fields, refusal === null ? null : refusal.code);

  // Belt and braces, and the two conditions are independent on purpose: the
  // walk's refusal earns the field, and a refusal ABOUT the address reveals it
  // too, so no refusal can ever name a field the founder cannot see.
  const addressOffended = offender !== null && offender.folded;
  const addressOffered = addressEarned || addressOffended;

  // Derived rather than pushed into state, so the frame that renders the
  // sentence already shows the field it names — a folded field must be expanded
  // BEFORE focus moves to it, because a hidden element cannot take focus.
  const expanded = unfolded || addressOffended;

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
    // The list was bought with the key that was just cleared, so it goes too.
    setDiscovery(null);
    setChoosing(null);

    const target = offendingField(step.fields, answer.code);
    if (target === null) {
      return;
    }

    // After the frame that `expanded` unfolds the field in: a hidden element
    // cannot take focus, so the order is load-bearing.
    requestAnimationFrame(() => inputs.current[target.id]?.focus());
  }

  // The second half of both paths, at the host the walk settled on.
  async function attach(input: AttachInput) {
    const { host, project, announcement } = input;

    const answer = await postJson(FIRST_RUN_API.analyticsConnect, {
      host,
      sourceProjectId: project.sourceProjectId,
      personalApiKey: values[PERSONAL_KEY] ?? "",
    });
    setPending(false);
    setChoosing(null);

    if (answer === null) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }
    if (answer.ok) {
      setDiscovery(null);
      setNotice(announcement);
      // The step's new state is persisted, so it is re-read rather than guessed
      // at here — a reload has to land on the same screen (D4).
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

  async function connect() {
    setPending(true);
    setRefusal(null);
    setFailure(null);
    setNotice(null);
    setDiscovery(null);

    // Empty means "walk the hosted regions"; typed means "I have my own
    // address". The field is never prefilled, so an untouched form walks.
    const address = (values[SELF_HOST_ADDRESS] ?? "").trim();
    const personalApiKey = values[PERSONAL_KEY] ?? "";
    const walked = address === "";

    const answer = await postJson(
      FIRST_RUN_API.analyticsDiscover,
      walked ? { personalApiKey } : { personalApiKey, host: address },
    );

    if (answer === null) {
      setPending(false);
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    if (!answer.ok) {
      setPending(false);
      // Earned here and nowhere else: every hosted region has answered and none
      // produced a list. Set on ANY refusal from the walk — a list of codes is
      // a list that drifts, and withholding the branch strands self-hosters.
      if (walked) {
        setAddressEarned(true);
      }

      const found = readRefusal(answer.body);
      if (found === null) {
        setFailure(ONBOARDING_MESSAGES.networkFailure);
        return;
      }
      refuse(found);
      return;
    }

    const found = readDiscovery(answer.body);
    if (found === null) {
      setPending(false);
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    const [only] = found.projects;
    if (found.projects.length === 1 && only !== undefined) {
      // AD-3: nothing is asked, and the sentence says which project we took.
      // `pending` stays true across both calls, so one press reads as one act.
      await attach({
        host: found.host,
        project: only,
        announcement: autoSelectedNotice(only.name),
      });
      return;
    }

    setPending(false);
    setDiscovery(found);
  }

  function choose(project: DiscoveredProjectView) {
    if (discovery === null) {
      return;
    }
    setPending(true);
    setChoosing(project.sourceProjectId);
    setRefusal(null);
    setFailure(null);
    setNotice(null);
    void attach({ host: discovery.host, project, announcement: null });
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

      {attached || discovery === null ? null : (
        <Stack gap="xs">
          <Text size="sm">{ONBOARDING_MESSAGES.projectPickPrompt}</Text>

          {discovery.projects.map((project) => (
            <Button
              key={project.sourceProjectId}
              variant="default"
              justify="flex-start"
              onClick={() => choose(project)}
              loading={choosing === project.sourceProjectId}
              disabled={locked && choosing !== project.sourceProjectId}
              style={tapTargetStyle}
              w="100%"
            >
              {project.name}
            </Button>
          ))}
        </Stack>
      )}

      {attached || discovery !== null ? null : (
        <Stack gap="sm">
          {visible.map((field) => renderField(field))}

          {!addressOffered
            ? null
            : folded.map((field) => (
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

// Out of the component body so the interpolation has one home.
function autoSelectedNotice(project: string): string {
  return ONBOARDING_MESSAGES.projectAutoSelectedTemplate.replaceAll("{project}", project);
}
