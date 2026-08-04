"use client";

// The settled half of delivery, which `SlackConnection` deliberately renders nothing for:
// there, an attached channel is the end of a setup step. Here it is a thing that can be
// moved and tested, and this component is the entry point that was missing.
import { Button, Group, Stack, Text } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ONBOARDING_MESSAGES } from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";

import {
  FIRST_RUN_API,
  SETTINGS_API,
  getJson,
  postJson,
  readChannelList,
  readChannelMoveAnswer,
  readRefusal,
  readTestPostAnswer,
  type SlackChannelChoice,
} from "../first-run/api";
import { ChannelPicker } from "./SlackConnection";

interface SlackDeliveryControlsProps {
  readonly channelId: string;
  readonly channelLabel: string | null;
}

export function SlackDeliveryControls(props: SlackDeliveryControlsProps) {
  const router = useRouter();

  const [picking, setPicking] = useState(false);
  const [pending, setPending] = useState(false);
  const [channels, setChannels] = useState<readonly SlackChannelChoice[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [listingAttempt, setListingAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Fetched only once the founder asks to move, so opening this page costs Slack nothing.
  useEffect(() => {
    if (!picking) {
      return undefined;
    }

    let current = true;

    void getJson(FIRST_RUN_API.slackChannels).then((answer) => {
      if (!current) {
        return;
      }
      if (answer === null) {
        setFailure(ONBOARDING_MESSAGES.networkFailure);
        return;
      }

      const list = readChannelList(answer.body);
      if (list === null) {
        setFailure(readRefusal(answer.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
        return;
      }
      setChannels(list);
    });

    return () => {
      current = false;
    };
  }, [picking, listingAttempt]);

  function open(): void {
    setNotice(null);
    setFailure(null);
    setChoice(null);
    setPicking(true);
  }

  function cancel(): void {
    setPicking(false);
    setChoice(null);
    setFailure(null);
  }

  function relist(): void {
    setFailure(null);
    setChannels(null);
    setListingAttempt((attempt) => attempt + 1);
  }

  async function move(): Promise<void> {
    if (choice === null) {
      return;
    }

    setPending(true);
    setFailure(null);
    setNotice(null);

    const answer = await postJson(SETTINGS_API.slackChannel, { channelId: choice });
    setPending(false);

    if (answer === null) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    const read = readChannelMoveAnswer(answer.body);
    if (read === null) {
      setFailure(
        readRefusal(answer.body)?.message ?? ONBOARDING_MESSAGES.settingsChannelMoveRefused,
      );
      return;
    }

    // Closed on both answers: "nothing changed" is a settled outcome too, and leaving the
    // picker open beside it reads as a move that has not finished.
    setPicking(false);
    setNotice(read.sentence);
    router.refresh();
  }

  async function test(): Promise<void> {
    setPending(true);
    setFailure(null);
    setNotice(null);

    const answer = await postJson(FIRST_RUN_API.slackTest, {});
    setPending(false);

    if (answer === null) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    const read = readTestPostAnswer(answer.body);
    if (read === null) {
      setFailure(readRefusal(answer.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    if (read.ok) {
      setNotice(read.sentence);
      return;
    }
    setFailure(read.sentence);
  }

  return (
    <Stack gap="sm">
      <Text>
        {ONBOARDING_MESSAGES.settingsPostingTemplate.replaceAll(
          "{channel}",
          props.channelLabel ?? props.channelId,
        )}
      </Text>

      {picking ? (
        <Stack gap="sm">
          {/* Above the picker, not under the confirm: what a move costs has to be readable
              before the choice is made, not after it is submitted. */}
          <Text size="sm" c="dimmed">
            {ONBOARDING_MESSAGES.settingsChannelChangeConsequence}
          </Text>

          <ChannelPicker
            channels={channels}
            value={choice}
            onChange={setChoice}
            onRefresh={relist}
            disabled={pending}
            loading={channels === null && failure === null}
          />
        </Stack>
      ) : (
        <Text c="dimmed">{ONBOARDING_MESSAGES.settingsSettled}</Text>
      )}

      {notice === null ? null : (
        <Text size="sm" c="dimmed">
          {notice}
        </Text>
      )}

      {failure === null ? null : (
        <Text size="sm" c="stamp.4">
          {failure}
        </Text>
      )}

      <Group gap="sm" wrap="wrap">
        {picking ? (
          <>
            <Button
              onClick={() => void move()}
              loading={pending}
              disabled={choice === null}
              style={tapTargetStyle}
              w={{ base: "100%", xs: "auto" }}
            >
              {ONBOARDING_MESSAGES.settingsChannelChange}
            </Button>
            <Button
              variant="subtle"
              color="gray"
              onClick={cancel}
              disabled={pending}
              style={tapTargetStyle}
              w={{ base: "100%", xs: "auto" }}
            >
              {ONBOARDING_MESSAGES.settingsChannelChangeCancel}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="default"
              onClick={open}
              disabled={pending}
              style={tapTargetStyle}
              w={{ base: "100%", xs: "auto" }}
            >
              {ONBOARDING_MESSAGES.settingsChannelChange}
            </Button>
            <Button
              variant="default"
              onClick={() => void test()}
              loading={pending}
              style={tapTargetStyle}
              w={{ base: "100%", xs: "auto" }}
            >
              {ONBOARDING_MESSAGES.sendTestMessage}
            </Button>
          </>
        )}
      </Group>
    </Stack>
  );
}
