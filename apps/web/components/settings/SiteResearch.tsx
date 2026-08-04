"use client";

import { Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ICP_BELIEF_HEADINGS,
  PAGES_SAVE_FAILED,
  SITE_DOMAIN_LABEL,
  SITE_DOMAIN_PLACEHOLDER,
  SITE_NEVER_RUN,
  SITE_NOTHING_FOUND,
  SITE_READ_ACTION,
  SITE_READ_AGAIN_ACTION,
  SITE_READ_FROM,
  SITE_RUNNING,
  SITE_SECTION_LEAD,
  SITE_TOLD_TO_US,
  type IcpBeliefKind,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";
import type { SiteResearchView } from "@/lib/settings/site";

import { SETTINGS_API, postJson } from "../first-run/api";

interface SiteResearchProps {
  readonly view: SiteResearchView;
}

const ORDER: readonly IcpBeliefKind[] = [
  "who_it_is_for",
  "what_they_believe",
  "what_they_are_trying_to_do",
];

export function SiteResearch({ view }: SiteResearchProps) {
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

  const hasBeliefs = view.beliefs.length > 0;

  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        {SITE_SECTION_LEAD}
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
      {view.status === "never_run" ? (
        <Text size="sm" c="dimmed">
          {SITE_NEVER_RUN}
        </Text>
      ) : null}
      {view.status === "done" && !hasBeliefs ? (
        <Text size="sm" c="dimmed">
          {SITE_NOTHING_FOUND}
        </Text>
      ) : null}

      {hasBeliefs
        ? ORDER.map((kind) => {
            const rows = view.beliefs.filter((belief) => belief.kind === kind);
            if (rows.length === 0) return null;

            return (
              <Stack key={kind} gap={2} mt="xs">
                <Text size="xs" fw={700} tt="uppercase" c="dimmed">
                  {ICP_BELIEF_HEADINGS[kind]}
                </Text>
                {rows.map((belief) => (
                  <Stack key={belief.statement} gap={0}>
                    <Text size="sm">{belief.statement}</Text>
                    {/* Provenance beside the claim, not in a tooltip: a claim without it is
                        a guess wearing a schema, and hiding it is the same thing. */}
                    <Text size="xs" c="dimmed">
                      {belief.readFrom === null
                        ? SITE_TOLD_TO_US
                        : `${SITE_READ_FROM} ${belief.readFrom}`}
                    </Text>
                  </Stack>
                ))}
              </Stack>
            );
          })
        : null}
    </Stack>
  );
}
