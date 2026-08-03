"use client";

import { Box, Button, Collapse, Group, Stack, Text } from "@mantine/core";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import {
  canArm,
  deriveStepStates,
  displayOrdinal,
  firstRunDeliveryStateSchema,
  isAnalyticsAttached,
  LIVE_STEP_DESCRIPTORS,
  ONBOARDING_MESSAGES,
  reduceStage,
  type OnboardingCounterView,
  type SetupFacts,
  type StagePersistedFacts,
  type StepSequenceFacts,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";
import { shouldRevealLead } from "@/lib/first-run/lead-reveal";
import { resolveOfflineNotice } from "@/lib/first-run/offline-notice";
import { resolvePollCadenceMs } from "@/lib/first-run/poll-cadence";
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

// Seeded from persisted stamps only, so the first render is SSR-safe —
// `Date.now()` appears in the timer callbacks and nowhere else.
function seedClock(status: FirstRunStatusPayload): number {
  const stamps = [status.armedAt, status.retrievedAt, status.readingAt, status.endedAt];

  return Math.max(0, ...stamps.map((at) => toStamp(at)?.getTime() ?? 0));
}

// A rolling deploy serves the shape the OLD instance had, so the delivery state is
// parsed rather than cast: `DELIVERY_TEMPLATES[undefined]` is a TypeError that takes the
// whole screen down, and an unreadable answer is worth no claim rather than a crash.
const deliveryStateOf = firstRunDeliveryStateSchema.catch("none");

function readStatus(body: unknown): FirstRunStatusPayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const counter = record.counter;

  if (typeof counter !== "object" || counter === null) {
    return null;
  }

  return {
    ...(body as FirstRunStatusPayload),
    deliveryState: deliveryStateOf.parse(record.deliveryState),
    deliveryFailureReason:
      typeof record.deliveryFailureReason === "string" ? record.deliveryFailureReason : null,
  };
}

async function pollStatus(): Promise<FirstRunStatusPayload | null> {
  try {
    const response = await fetch(FIRST_RUN_API.status);
    return response.ok ? readStatus((await response.json()) as unknown) : null;
  } catch {
    return null;
  }
}

const LiveCounter = createContext<OnboardingCounterView | null>(null);

// The server subtree's counter is a frozen element tree; a client component
// inside it still re-renders when a context it consumes changes.
export function useLiveCounter(fallback: OnboardingCounterView): OnboardingCounterView {
  return useContext(LiveCounter) ?? fallback;
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

  // Every member is a persisted row or stamp, so a second tab, a reload and a
  // return tomorrow all land on the sentence the database describes.
  //
  // `workspaceAttached` comes off the payload and is never re-derived from
  // `channelId` (AD-4): OAuth splits attaching a workspace from choosing a
  // channel, and derived from the address this flag was false in exactly that
  // window. `deliveryResolved` keeps both its halves and does NOT take the
  // workspace flag — an attached workspace is not somewhere to deliver.
  const setupFacts: SetupFacts = {
    analyticsAttached: attached,
    workspaceAttached: current.slackWorkspaceAttached,
    deliveryResolved: current.channelId !== null || current.slackSkippedAt !== null,
    armedAt: facts.armedAt,
  };

  const offered = !armed && canArm(setupFacts);

  const armedOnArrival = useRef(armed);
  const wasOffered = useRef(offered);
  const lead = useRef<HTMLDivElement>(null);
  const handle = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const busy = useRef(false);

  // The one control that ends setup is above the steps; the press that completes the
  // last step is at the bottom of the page.
  useEffect(() => {
    const node = lead.current;

    const reveal = shouldRevealLead({
      offeredBefore: wasOffered.current,
      offeredNow: offered,
      box: node === null ? null : node.getBoundingClientRect(),
      viewportHeight: window.innerHeight,
    });

    wasOffered.current = offered;

    if (!reveal || node === null) {
      return undefined;
    }

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });

    return undefined;
  }, [offered]);

  // Whether a terminal stage still has something to watch is the cadence question, and it
  // has one home. Asking it here as well is how the screen stopped polling with the
  // delivery line still reading "not posted", and how a founder who never armed but has a
  // finding from the hourly check got a counter that never moved again.
  const cadenceMs = resolvePollCadenceMs({
    attached,
    armed,
    terminal,
    deliveryState: current.deliveryState,
  });

  useEffect(() => {
    if (cadenceMs === null) {
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
    }, cadenceMs);

    const first = setTimeout(() => setNowMs(Date.now()), 0);

    return () => {
      clearTimeout(first);
      clearInterval(handle.current);
    };
  }, [cadenceMs]);

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

  const notice = resolveOfflineNotice({ lost, armed, terminal });

  return (
    <LiveCounter value={current.counter}>
      <Stack gap="md">
        {/* The payoff is first in both phases: the blocker panel naming the one
          next thing before there is anything to watch, the stage after arming.
          `findingUnavailable` rides the poll rather than a client flag, so a
          row that becomes readable clears the sentence on its own. */}
        <Box ref={lead}>
          {armed ? (
            <Stage
              facts={facts}
              nowMs={nowMs}
              channelId={current.channelId}
              channelLabel={current.channelLabel}
              findingUnavailable={current.findingUnavailable === true}
              delivery={current.deliveryState}
              deliveryReason={current.deliveryFailureReason ?? null}
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
        </Box>

        {armed ? (
          <Box className={armedOnArrival.current ? undefined : styles.foldIn}>
            <Strip
              counter={current.counter}
              channelLabel={current.channelLabel}
              notice={current.slackNotice}
              reopened={reopened}
              onToggle={() => setReopened((shown) => !shown)}
            />
          </Box>
        ) : null}

        {armed ? (
          <Collapse expanded={reopened}>
            <Stack gap="md">
              {/* `displayOrdinal`, not `descriptor.ordinal`: the record numbers
                the steps the way the founder counted them. */}
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

        {/* Which sentence a lost connection may claim depends on whether a check is
          running at all; before arming there is none, and the elapsed it refers to is
          not counting. Either line disappears again on its own. */}
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
    </LiveCounter>
  );
}
