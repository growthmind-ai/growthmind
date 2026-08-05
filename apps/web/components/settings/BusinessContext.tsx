"use client";

import { Box, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
  BINDING_SECTION_LEAD,
  BINDING_SECTION_TITLE,
  BUSINESS_FACT_HEADINGS,
  BUSINESS_FACT_NOTES,
  BUSINESS_SECTION_LEAD,
  FACT_CLAIM_LABEL,
  FACT_NONE_READ_YET,
  FACT_NOTHING_ON_YOUR_SITE,
  FACT_OBSERVED_LABEL,
  FACT_OBSERVED_NONE_YET,
  FACT_OBSERVED_NO_SOURCE,
  FACT_ONLY_YOU_KNOW,
  PAGES_SAVE_FAILED,
  SHAPING_SECTION_LEAD,
  SHAPING_SECTION_TITLE,
  SITE_DOMAIN_LABEL,
  SITE_DOMAIN_PLACEHOLDER,
  SITE_NEVER_RUN,
  SITE_NOTHING_FOUND,
  SITE_READ_ACTION,
  SITE_READ_AGAIN_ACTION,
  SITE_RUNNING,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";
import { hasAnyFact, type BusinessResearchView, type FactLaneView } from "@/lib/settings/business";

import { SETTINGS_API, postJson } from "../first-run/api";
import { AddFact, FactRow } from "./FactRow";
import { ObservedRow } from "./ObservedRow";

interface BusinessContextProps {
  readonly view: BusinessResearchView;

  // Decides which of the two empty observed lanes is true: waiting for people, or waiting
  // for a day that cannot come until analytics is connected.
  readonly sourceAttached: boolean;
}

const laneStyle = {
  borderLeft: "2px solid var(--mantine-color-default-border)",
} as const;

function Lane({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box pl="sm" style={laneStyle}>
      <Text size="xs" fw={600} c="dimmed">
        {label}
      </Text>
      <Stack gap={6} mt={2}>
        {children}
      </Stack>
    </Box>
  );
}

function emptyStatedNote(lane: FactLaneView, everRead: boolean): string {
  if (lane.statedOnly) return FACT_ONLY_YOU_KNOW;

  return everRead ? FACT_NOTHING_ON_YOUR_SITE : FACT_NONE_READ_YET;
}

function Question({
  lane,
  everRead,
  sourceAttached,
}: {
  lane: FactLaneView;
  everRead: boolean;
  sourceAttached: boolean;
}) {
  return (
    <Stack gap={6} mt="sm">
      <Box>
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          {BUSINESS_FACT_HEADINGS[lane.kind]}
        </Text>
        <Text size="xs" c="dimmed">
          {BUSINESS_FACT_NOTES[lane.kind]}
        </Text>
      </Box>

      {/* Add is offered on every kind whether or not anything is here. Five of the twelve
          have no reader that could ever propose them, so a correct-only row would leave
          them permanently empty with no way in (D11). */}
      <Lane label={FACT_CLAIM_LABEL}>
        {lane.stated.length === 0 ? (
          <Text size="sm" c="dimmed">
            {emptyStatedNote(lane, everRead)}
          </Text>
        ) : (
          lane.stated.map((fact) => <FactRow key={fact.statement} fact={fact} />)
        )}
        <AddFact kind={lane.kind} />
      </Lane>

      {/* Only where behaviour could ever answer it. A permanently empty "We see" under a
          licence or a forbidden move is a promise nothing can keep. */}
      {lane.observable ? (
        <Lane label={FACT_OBSERVED_LABEL}>
          {lane.observed.length === 0 ? (
            <Text size="sm" c="dimmed">
              {sourceAttached ? FACT_OBSERVED_NONE_YET : FACT_OBSERVED_NO_SOURCE}
            </Text>
          ) : (
            lane.observed.map((fact) => <ObservedRow key={fact.statement} fact={fact} />)
          )}
        </Lane>
      ) : null}
    </Stack>
  );
}

// `heading` rather than `title`: a prop named `title` is indistinguishable by regex from the
// HTML attribute rrweb cannot mask, and would land in the exposure register as a false
// positive — see __tests__/replay-attribute-exposure.test.ts.
function FactSection({
  heading,
  lead,
  lanes,
  everRead,
  sourceAttached,
}: {
  heading: string;
  lead: string;
  lanes: readonly FactLaneView[];
  everRead: boolean;
  sourceAttached: boolean;
}) {
  return (
    <Stack gap={2} mt="md">
      <Text size="sm" fw={600}>
        {heading}
      </Text>
      <Text size="xs" c="dimmed">
        {lead}
      </Text>
      {lanes.map((lane) => (
        <Question
          key={lane.kind}
          lane={lane}
          everRead={everRead}
          sourceAttached={sourceAttached}
        />
      ))}
    </Stack>
  );
}

export function BusinessContext({ view, sourceAttached }: BusinessContextProps) {
  const router = useRouter();
  const [domain, setDomain] = useState(view.domain ?? "");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  async function read(): Promise<void> {
    setPending(true);
    setFailed(null);

    const answer = await postJson(SETTINGS_API.site, { domain });

    setPending(false);

    if (answer === null || !answer.ok) {
      setFailed(PAGES_SAVE_FAILED);
      return;
    }

    // The read happens in the worker, so the page has to go and look rather than assume.
    router.refresh();
  }

  const everRead = view.status === "done" || view.status === "failed";
  const anything = hasAnyFact(view.binding) || hasAnyFact(view.shaping);

  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        {BUSINESS_SECTION_LEAD}
      </Text>

      <Group gap="sm" align="flex-end" wrap="wrap">
        <TextInput
          label={SITE_DOMAIN_LABEL}
          placeholder={SITE_DOMAIN_PLACEHOLDER}
          value={domain}
          onChange={(event) => setDomain(event.currentTarget.value)}
          style={{ ...tapTargetStyle, minWidth: 260 }}
        />
        <Button
          onClick={() => void read()}
          loading={pending}
          disabled={domain.trim().length === 0}
          style={tapTargetStyle}
        >
          {view.status === "never_run" ? SITE_READ_ACTION : SITE_READ_AGAIN_ACTION}
        </Button>
      </Group>

      {failed === null ? null : (
        <Text size="sm" c="red" component="output">
          {failed}
        </Text>
      )}

      {/* Every status says what happened, including the ones where nothing did. */}
      {view.status === "running" ? <Text size="sm">{SITE_RUNNING}</Text> : null}
      {view.status === "failed" && view.failure !== null ? (
        <Text size="sm" c="red">
          {view.failure}
        </Text>
      ) : null}
      {view.status === "never_run" && !anything ? (
        <Text size="sm" c="dimmed">
          {SITE_NEVER_RUN}
        </Text>
      ) : null}
      {view.status === "done" && !anything ? (
        <Text size="sm" c="dimmed">
          {SITE_NOTHING_FOUND}
        </Text>
      ) : null}

      {/* Both sections render whatever the read found. The five kinds only a person can
          answer are the point of the page, and gating the whole thing on a successful crawl
          would hide them behind a step that can never produce them. */}
      <FactSection
        heading={BINDING_SECTION_TITLE}
        lead={BINDING_SECTION_LEAD}
        lanes={view.binding}
        everRead={everRead}
        sourceAttached={sourceAttached}
      />
      <FactSection
        heading={SHAPING_SECTION_TITLE}
        lead={SHAPING_SECTION_LEAD}
        lanes={view.shaping}
        everRead={everRead}
        sourceAttached={sourceAttached}
      />
    </Stack>
  );
}
