"use client";

// STEP 3 — SLACK, AND THE SKIP THAT IS A REAL ANSWER
// (O-008, FR-O11, FR-O13, FR-O14, UX Checklist rows 12-16 and Flow D).
//
// ###########################################################################
// # "SKIP FOR NOW" IS ALWAYS IN THE ROW, INCLUDING AFTER A FAILURE.
// #
// # Deviation 2: a skip a founder cannot find is not a skip. Whatever went
// # wrong with the token, the channel or the network, setup is NOT broken and
// # the sequence still reaches step 5 — so the secondary action never
// # disappears and the step never renders as an error state.
// #
// # RETRY IS OFFERED ONLY WHERE IT CAN WORK. Two of the four post failures
// # need a human to go and reconnect or repick before anything can change;
// # offering "Try again" there is a button that can never succeed, and the
// # founder presses it until they give up. The route already computes which
// # ones are retryable from the delivery lane's own opinion, so this form
// # renders that answer rather than forming a second one.
// #
// # ONE PRESS, TWO CALLS. "Send a test message" attaches the channel and then
// # posts to it. That is the whole reason the click path fits inside ten: a
// # separate "Connect" press would buy nothing, because a connection nobody
// # has posted through has proved nothing.
// #
// # THE CHANNEL IS NEVER SENT TO THE TEST ROUTE (FR-O13). It is read from the
// # stored row there. A caller that could name a channel could post this
// # workspace's announcement into one it does not own.
// ###########################################################################
import { Button, Group, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type ReactNode } from "react";

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
  readRefusal,
  readTestPostAnswer,
  type TestPostAnswer,
} from "./api";
import { initialValues, type FieldValues } from "./form-fields";

/** The two field ids, named once — see the note in step 2's form. */
const BOT_TOKEN = "botToken";
const CHANNEL_ID = "channelId";

interface ConnectSlackFormProps {
  readonly step: WorkStep;
  readonly view: StepView;
  /** FR-O13: read from the stored row. `null` until a channel is attached. */
  readonly channelId: string | null;
}

export function ConnectSlackForm(props: ConnectSlackFormProps) {
  const { step, view, channelId } = props;
  const router = useRouter();

  const [values, setValues] = useState<FieldValues>(() => initialValues(step.fields));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<TestPostAnswer | null>(null);
  // The channel attached DURING this visit. A second connect attempt on an org
  // that already has one is refused by a database constraint, so once the
  // channel is on, the retry path posts and does not re-attach.
  const [attachedNow, setAttachedNow] = useState(channelId !== null);

  const settled = view.state === "done" || view.state === "skipped";
  const locked = pending || !view.interactive;

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
    };

    return field.secret ? (
      <PasswordInput key={field.id} {...shared} />
    ) : (
      <TextInput key={field.id} {...shared} />
    );
  }

  /** The post itself, which is the only half a retry repeats. */
  async function post(): Promise<void> {
    const answer = await postJson(FIRST_RUN_API.slackTest, {});

    if (answer === null) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    const read = readTestPostAnswer(answer.body);
    if (read === null) {
      setFailure(readRefusal(answer.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    setOutcome(read);
    if (read.marksStepDone) {
      router.refresh();
    }
  }

  async function send() {
    setPending(true);
    setFailure(null);
    setOutcome(null);

    if (!attachedNow) {
      const attached = await postJson(FIRST_RUN_API.slackConnect, {
        botToken: values[BOT_TOKEN] ?? "",
        channelId: values[CHANNEL_ID] ?? "",
      });

      if (attached === null || !attached.ok) {
        setPending(false);
        setFailure(readRefusal(attached?.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
        return;
      }
      setAttachedNow(true);
    }

    await post();
    setPending(false);
  }

  async function retry() {
    setPending(true);
    setFailure(null);
    setOutcome(null);
    await post();
    setPending(false);
  }

  async function skip() {
    setPending(true);
    setFailure(null);

    const answer = await postJson(FIRST_RUN_API.slackSkip, {});
    setPending(false);

    if (answer === null || !answer.ok) {
      setFailure(readRefusal(answer?.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
      return;
    }
    router.refresh();
  }

  return (
    <Stack gap="sm">
      {settled ? null : <Stack gap="sm">{step.fields.map((field) => renderField(field))}</Stack>}

      {outcome === null ? null : (
        <Text size="sm" c={outcome.ok ? "dimmed" : "stamp.4"}>
          {outcome.sentence}
        </Text>
      )}

      {failure === null ? null : (
        <Text size="sm" c="stamp.4">
          {failure}
        </Text>
      )}

      {/* FR-O14. Derived from a resolved step state, which is itself derived
          from the persisted ABSENCE of a connection — so it survives a reload
          by construction, and a workspace that later connects stops seeing it
          without anybody clearing a flag. */}
      {view.state === "skipped" ? (
        <Text size="sm" c="dimmed">
          {ONBOARDING_MESSAGES.slackSkippedNotice}
        </Text>
      ) : null}

      {settled || !view.interactive ? null : (
        <Group gap="sm" wrap="wrap">
          <Button
            onClick={() => void send()}
            loading={pending}
            disabled={locked}
            style={tapTargetStyle}
            w={{ base: "100%", xs: "auto" }}
          >
            {pending ? ONBOARDING_MESSAGES.sendingTestMessage : ONBOARDING_MESSAGES.sendTestMessage}
          </Button>

          {outcome !== null && !outcome.ok && outcome.retryable ? (
            <Button
              variant="default"
              onClick={() => void retry()}
              disabled={locked}
              style={tapTargetStyle}
              w={{ base: "100%", xs: "auto" }}
            >
              {ONBOARDING_MESSAGES.tryAgain}
            </Button>
          ) : null}

          <Button
            variant="subtle"
            color="gray"
            onClick={() => void skip()}
            disabled={locked}
            style={tapTargetStyle}
            w={{ base: "100%", xs: "auto" }}
          >
            {ONBOARDING_MESSAGES.skipForNow}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
