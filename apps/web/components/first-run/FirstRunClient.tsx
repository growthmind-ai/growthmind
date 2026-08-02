"use client";

import { Box, Button, Collapse, Group, Stack, Text } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  deriveStepStates,
  displayOrdinal,
  isAnalyticsAttached,
  LIVE_STEP_DESCRIPTORS,
  ONBOARDING_MESSAGES,
  reduceStage,
  type SetupFacts,
  type StagePersistedFacts,
  type StepSequenceFacts,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";
import type { FirstRunStatusPayload } from "@/lib/first-run/status";
import { ROUTES } from "@/lib/routes";

import { FIRST_RUN_API, postJson } from "./api";
import styles from "./first-run.module.css";
import { SetupStage } from "./SetupStage";
import { Stage } from "./Stage";
import { StepRow } from "./StepRow";
import { Strip } from "./Strip";

function toStamp(at: Date | null): Date | null {
  return at === null ? null : new Date(at);
}

function seedClock(status: FirstRunStatusPayload): number {
  const stamps = [status.armedAt, status.retrievedAt, status.readingAt, status.endedAt];

  return stamps.reduce((newest, at) => {
    const stamp = toStamp(at);
    return stamp === null ? newest : Math.max(newest, stamp.getTime());
  }, 0);
}

function readStatus(body: unknown): FirstRunStatusPayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const counter = record.counter;

  return typeof counter === "object" && counter !== null ? (body as FirstRunStatusPayload) : null;
}

async function pollStatus(): Promise<FirstRunStatusPayload | null> {
  try {
    const response = await fetch(FIRST_RUN_API.status);
    return response.ok ? readStatus((await response.json()) as unknown) : null;
  } catch {
    return null;
  }
}

interface FirstRunClientProps {
  readonly status: FirstRunStatusPayload;

  readonly children: ReactNode;
}

export function FirstRunClient(props: FirstRunClientProps) {
  const router = useRouter();

  const [polled, setPolled] = useState<FirstRunStatusPayload | null>(null);
  const [nowMs, setNowMs] = useState(() => seedClock(props.status));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [lost, setLost] = useState(false);
  const [reopened, setReopened] = useState(false);
  const [folding, setFolding] = useState(false);

  const current = polled ?? props.status;

  const facts: StagePersistedFacts = {
    armedAt: toStamp(current.armedAt),
    retrievedAt: toStamp(current.retrievedAt),
    readingAt: toStamp(current.readingAt),
    endedAt: toStamp(current.endedAt),
    runStatus: current.runStatus,
    runOutcome: current.runOutcome,
    finding: current.finding,
  };

  const armed = facts.armedAt !== null;
  const kind = reduceStage(facts, nowMs).kind;
  const terminal = kind === "finding" || kind === "ended";

  const connectionState = current.counter.state;
  const attached = isAnalyticsAttached(
    connectionState.status === "not_connected" ? null : connectionState.status,
  );

  const setupFacts: SetupFacts = {
    analyticsAttached: attached,
    workspaceAttached: current.channelId !== null,
    deliveryResolved: current.channelId !== null || current.slackSkippedAt !== null,
    armedAt: facts.armedAt,
  };

  const armedOnArrival = useRef(armed);
  const handle = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const busy = useRef(false);

  useEffect(() => {
    if (!armed || terminal) {
      clearInterval(handle.current);
      return undefined;
    }

    handle.current = setInterval(() => {
      setNowMs(Date.now());

      if (busy.current) {
        return;
      }
      busy.current = true;

      void pollStatus().then((next) => {
        busy.current = false;
        setLost(next === null);

        if (next !== null) {
          setPolled(next);
        }
      });
    }, 1000);

    const first = setTimeout(() => setNowMs(Date.now()), 0);

    return () => {
      clearTimeout(first);
      clearInterval(handle.current);
    };
  }, [armed, terminal]);

  useEffect(() => {
    if (!folding) {
      return undefined;
    }

    const settle = setTimeout(() => setFolding(false), 200);
    return () => clearTimeout(settle);
  }, [folding]);

  async function startWatching(): Promise<void> {
    setPending(true);
    setFailure(null);

    const answer = await postJson(FIRST_RUN_API.arm, {});
    setPending(false);

    const next = answer === null || !answer.ok ? null : readStatus(answer.body);
    if (next === null) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    setFolding(!armed);
    setPolled(next);
  }

  async function finish(): Promise<void> {
    setPending(true);
    setFailure(null);

    const answer = await postJson(FIRST_RUN_API.dismiss, {});
    setPending(false);

    if (answer === null || !answer.ok) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    router.push(ROUTES.home);
  }

  const sequenceFacts: StepSequenceFacts = {
    connectionStatus: connectionState.status === "not_connected" ? null : connectionState.status,
    slackConnected: current.channelId !== null,
    slackSkipped: current.slackSkippedAt !== null,

    slackTestPostFailed: false,
    armedAt: facts.armedAt,

    reopenedReadOnly: true,
  };

  const resolved = new Map(deriveStepStates(sequenceFacts).map((view) => [view.id, view]));

  return (
    <Stack gap="md">
      {/* ################################################################
          THE PAYOFF IS FIRST, IN BOTH PHASES, AND THAT IS THE WHOLE REDESIGN.

          Before there is anything to watch, this is the blocker panel naming
          the one next thing; after arming it is the shipped stage. Either way
          the thing the founder came for is the top of the screen rather than
          an untitled empty card underneath two forms and two rows about work
          that does not exist yet.

          EC-O5 rides the poll, not a client flag: the route is the authority
          on it and re-answers every tick, so a row that becomes readable
          clears the sentence on its own.
          ################################################################ */}
      {armed ? (
        <Stage
          facts={facts}
          nowMs={nowMs}
          channelId={current.channelId}
          findingUnavailable={current.findingUnavailable === true}
        />
      ) : (
        <SetupStage
          facts={setupFacts}
          counter={current.counter}
          attached={attached}
          pending={pending}
          onArm={() => void startWatching()}
        />
      )}

      {armed ? (
        <Box className={armedOnArrival.current ? undefined : styles.foldIn}>
          <Strip
            counter={current.counter}
            channelId={current.channelId}
            notice={current.slackNotice}
            reopened={reopened}
            onToggle={() => setReopened((shown) => !shown)}
          />
        </Box>
      ) : null}

      {armed ? (
        <Collapse expanded={reopened}>
          <Stack gap="md">
            {/* THE RE-OPENED RECORD SHOWS WHAT WAS DONE, so it lists the same
                steps the sequence listed and numbers them the same way. The
                stubs are absent for the reason they left the sequence: nothing
                was done to them, and a record of work should not list work
                that does not exist.

                `displayOrdinal`, NOT `descriptor.ordinal` — the record showing
                2, 3, 5 beside steps the founder counted as 1, 2, 3 would be a
                second numbering of one sequence. */}
            {LIVE_STEP_DESCRIPTORS.map((descriptor) => {
              const view = resolved.get(descriptor.id);
              if (view === undefined) {
                return null;
              }

              return (
                <StepRow
                  key={descriptor.id}
                  ordinal={displayOrdinal(descriptor.id)}
                  title={descriptor.title}
                  helper={descriptor.kind === "work" ? descriptor.helper : null}
                  state={view.state}
                  open={false}
                />
              );
            })}
          </Stack>
        </Collapse>
      ) : null}

      {armed && !folding ? null : (
        <Box className={folding ? styles.foldOut : undefined}>{props.children}</Box>
      )}

      {/* The page lost the connection; the check did not. The elapsed keeps
          counting and the line disappears again on its own. */}
      {lost && !terminal ? (
        <Text size="sm" c="dimmed">
          {ONBOARDING_MESSAGES.offlineNotice}
        </Text>
      ) : null}

      {failure === null ? null : (
        <Text size="sm" c="stamp.4">
          {failure}
        </Text>
      )}

      {terminal ? (
        <Group gap="sm" wrap="wrap">
          {kind === "ended" ? (
            <Button
              variant="default"
              onClick={() => void startWatching()}
              loading={pending}
              className={styles.action}
              style={tapTargetStyle}
              w={{ base: "100%", xs: "auto" }}
            >
              {ONBOARDING_MESSAGES.watchAgain}
            </Button>
          ) : null}

          <Button
            onClick={() => void finish()}
            loading={pending}
            className={styles.action}
            style={tapTargetStyle}
            w={{ base: "100%", xs: "auto" }}
          >
            {ONBOARDING_MESSAGES.done}
          </Button>
        </Group>
      ) : null}
    </Stack>
  );
}
