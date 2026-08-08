"use client";

import { Checkbox, Divider, Group, Select, Stack, Text } from "@mantine/core";
import { useState } from "react";

import {
  ALWAYS_LINE,
  BELL_BODY,
  BELL_LABEL,
  CADENCE_SELECT_LABEL,
  DAY_SELECT_LABEL,
  DIGEST_CADENCES,
  DIGEST_CADENCE_CHOICE_LABELS,
  HEALTH_BODY,
  HEALTH_LABEL,
  MUTABLE_NOTIFICATION_CLASSES,
  NOTIFICATION_CLASS_CARD_DESCRIPTIONS,
  NOTIFICATION_CLASS_CARD_LABELS,
  PAGES_SAVE_FAILED,
  PAGES_SAVED,
  SUMMARY_NO_SLACK_TEMPLATE,
  SUMMARY_OFF,
  SUMMARY_WEEKLY_TEMPLATE,
  WEEKDAYS,
  weekdayChoiceLabel,
  weekdayName,
  type DigestCadence,
  type MutableNotificationClass,
  type Weekday,
} from "@growthmind/shared";

import { LeadIn } from "@/components/ui/Eyebrow";
import { tapTargetStyle } from "@/components/ui/tap-target";

import { SETTINGS_API, postJson } from "../first-run/api";

// Every customer-facing word here comes from the shared registry, so the jargon and
// completeness audits walk it (CR-6); this file only shapes choices for the pickers.
const CADENCE_CHOICES = DIGEST_CADENCES.map((value) => ({
  value,
  label: DIGEST_CADENCE_CHOICE_LABELS[value],
}));

const DAY_CHOICES = WEEKDAYS.map((day) => ({ value: day, label: weekdayChoiceLabel(day) }));

function summarySentence(
  cadence: DigestCadence,
  day: Weekday,
  channelLabel: string | null,
): string {
  if (cadence === "off") {
    return SUMMARY_OFF;
  }

  if (channelLabel === null) {
    return SUMMARY_NO_SLACK_TEMPLATE.replace("{Day}", weekdayName(day));
  }

  return SUMMARY_WEEKLY_TEMPLATE.replace("{channel}", channelLabel).replace(
    "{Day}",
    weekdayName(day),
  );
}

export interface NotificationPreferencesProps {
  readonly cadence: DigestCadence;
  readonly day: Weekday;
  readonly shown: readonly MutableNotificationClass[];
  readonly channelLabel: string | null;
}

type ControlKey = "cadence" | "day" | MutableNotificationClass;

interface DigestState {
  readonly cadence: DigestCadence;
  readonly day: Weekday;
}

function SaveNotice({ state }: { readonly state: "saved" | "failed" | undefined }) {
  if (state === undefined) {
    return null;
  }

  return (
    <Text component="output" size="xs" c={state === "failed" ? "stamp.4" : "dimmed"}>
      {state === "failed" ? PAGES_SAVE_FAILED : PAGES_SAVED}
    </Text>
  );
}

export function NotificationPreferences({
  cadence,
  day,
  shown,
  channelLabel,
}: NotificationPreferencesProps) {
  const [digest, setDigest] = useState<DigestState>({ cadence, day });
  const [shownClasses, setShownClasses] = useState<readonly MutableNotificationClass[]>(shown);

  // Per control, never per section: four controls, four notice slots (the PageRoles mold).
  const [notice, setNotice] = useState<Partial<Record<ControlKey, "saved" | "failed">>>({});

  function clearNotice(control: ControlKey): void {
    setNotice((current) => {
      const { [control]: _cleared, ...rest } = current;
      return rest;
    });
  }

  async function saveDigest(control: "cadence" | "day", next: DigestState): Promise<void> {
    const previous = digest;
    setDigest(next);
    clearNotice(control);

    // Both fields on every change: the client still holds the day while cadence is off,
    // which is what makes the off/weekly round trip keep it with no server-side memory.
    const answer = await postJson(SETTINGS_API.notificationsDigest, next);

    if (answer === null || !answer.ok) {
      setDigest(previous);
      setNotice((current) => ({ ...current, [control]: "failed" }));
      return;
    }

    setNotice((current) => ({ ...current, [control]: "saved" }));
  }

  async function saveBell(muteClass: MutableNotificationClass, isShown: boolean): Promise<void> {
    const previous = shownClasses;
    setShownClasses(
      isShown
        ? [...previous.filter((entry) => entry !== muteClass), muteClass]
        : previous.filter((entry) => entry !== muteClass),
    );
    clearNotice(muteClass);

    const answer = await postJson(SETTINGS_API.notificationsBell, {
      class: muteClass,
      shown: isShown,
    });

    if (answer === null || !answer.ok) {
      setShownClasses(previous);
      setNotice((current) => ({ ...current, [muteClass]: "failed" }));
      return;
    }

    setNotice((current) => ({ ...current, [muteClass]: "saved" }));
  }

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Text size="sm">{summarySentence(digest.cadence, digest.day, channelLabel)}</Text>

        <Group gap="sm" wrap="wrap" align="flex-end">
          <Stack gap={4} w={{ base: "100%", xs: "auto" }}>
            <Select
              label={CADENCE_SELECT_LABEL}
              data={CADENCE_CHOICES}
              value={digest.cadence}
              allowDeselect={false}
              onChange={(value) => {
                if (value === null) return;
                void saveDigest("cadence", { cadence: value as DigestCadence, day: digest.day });
              }}
              w={{ base: "100%", xs: "auto" }}
              style={{ ...tapTargetStyle, minWidth: 200 }}
            />
            <SaveNotice state={notice.cadence} />
          </Stack>

          {digest.cadence === "weekly" ? (
            <Stack gap={4} w={{ base: "100%", xs: "auto" }}>
              <Select
                label={DAY_SELECT_LABEL}
                data={DAY_CHOICES}
                value={digest.day}
                allowDeselect={false}
                onChange={(value) => {
                  if (value === null) return;
                  void saveDigest("day", { cadence: digest.cadence, day: value as Weekday });
                }}
                w={{ base: "100%", xs: "auto" }}
                style={{ ...tapTargetStyle, minWidth: 200 }}
              />
              <SaveNotice state={notice.day} />
            </Stack>
          ) : null}
        </Group>
      </Stack>

      <LeadIn label={HEALTH_LABEL} size="sm">
        {HEALTH_BODY}
      </LeadIn>

      <Divider w={48} my="xs" />

      <Stack gap="xs">
        <LeadIn label={BELL_LABEL} size="sm">
          {BELL_BODY}
        </LeadIn>

        {MUTABLE_NOTIFICATION_CLASSES.map((muteClass) => (
          <Stack key={muteClass} gap={4}>
            <Checkbox
              checked={shownClasses.includes(muteClass)}
              onChange={(event) => {
                void saveBell(muteClass, event.currentTarget.checked);
              }}
              label={NOTIFICATION_CLASS_CARD_LABELS[muteClass]}
              description={NOTIFICATION_CLASS_CARD_DESCRIPTIONS[muteClass]}
              style={tapTargetStyle}
            />
            <SaveNotice state={notice[muteClass]} />
          </Stack>
        ))}

        <Text size="xs" c="dimmed">
          {ALWAYS_LINE}
        </Text>
      </Stack>
    </Stack>
  );
}
