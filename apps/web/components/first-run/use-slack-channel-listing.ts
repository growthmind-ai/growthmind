"use client";

import { useEffect, useState } from "react";

import { ONBOARDING_MESSAGES } from "@growthmind/shared";

import {
  FIRST_RUN_API,
  getJson,
  readChannelList,
  readRefusal,
  type SlackChannelChoice,
} from "./api";

// Shared by `SlackConnection` and `SlackDeliveryControls`: both list the org's Slack
// channels the same way, fetched only while `active` and re-fetched only on `relist()`
// (AD-7 — nothing is cached, so a channel created a minute ago is still pickable).
export function useSlackChannelListing(
  active: boolean,
  reportFailure: (message: string) => void,
): { readonly channels: readonly SlackChannelChoice[] | null; readonly relist: () => void } {
  const [channels, setChannels] = useState<readonly SlackChannelChoice[] | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let current = true;

    void getJson(FIRST_RUN_API.slackChannels).then((answer) => {
      if (!current) {
        return;
      }
      if (answer === null) {
        reportFailure(ONBOARDING_MESSAGES.networkFailure);
        return;
      }

      const list = readChannelList(answer.body);
      if (list === null) {
        reportFailure(readRefusal(answer.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
        return;
      }
      setChannels(list);
    });

    return () => {
      current = false;
    };
  }, [active, attempt, reportFailure]);

  function relist(): void {
    setChannels(null);
    setAttempt((n) => n + 1);
  }

  return { channels, relist };
}
