"use client";

// THE GLUE MOMENT'S ISLAND (O-008, AD-5, AD-18, FR-O19, storyboard T6-T13).
//
// ###########################################################################
// # THE FOLD IS DRIVEN BY A PERSISTED STAMP, NEVER BY A CLIENT FLAG.
// #
// # Phase B begins when `armedAt` exists on the row, full stop. There is no
// # "I pressed the button" boolean anywhere in this file, and its absence is
// # the guarantee: a reader who reloads mid-setup, opens a second tab, or comes
// # back tomorrow lands on the state the database describes rather than on the
// # state some client happened to remember. The same rule is what makes a
// # finding that landed while the tab was closed render on first paint.
// #
// # ONE PRESS DOES TWO THINGS (T6 AND T8 TOGETHER). "Start watching" folds
// # phase A away AND starts the clock, because a second press to begin the
// # wait buys nothing and costs the click budget its last spare action.
// ###########################################################################
//
// ── THE CLOCK, AND WHY IT LOOKS THE WAY IT DOES ─────────────────────────────
//
// Elapsed is `now − armedAt`, RECOMPUTED on every tick from the persisted
// origin — never an incremented counter. A backgrounded tab, a dropped frame
// and a hard reload therefore all come back with the right number, which is
// exactly what a reader who left to go and break their own product needs.
//
// `Date.now()` appears only inside timer callbacks. A component body that
// called it would return a different tree on renders nobody asked for, and
// React 19.2 asks for plenty. The initial value is seeded from PERSISTED
// stamps alone, so the server and the browser agree on the first paint and
// nothing flashes a restarted wait at somebody who reloaded thirty seconds in.
//
// ── WHAT THIS FILE DOES NOT DO ──────────────────────────────────────────────
//
// It does not derive what the stage is showing: `reduceStage` owns that branch
// order, and it is called here for one question only — has the wait finished,
// so the interval can stop. It authors no sentence; every string comes from the
// shipped tables. And it renders no list of anything.
import { Box, Button, Collapse, Group, Stack, Text } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  deriveStepStates,
  ONBOARDING_MESSAGES,
  reduceStage,
  STEP_DESCRIPTORS,
  type StagePersistedFacts,
  type StepSequenceFacts,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";
import type { FirstRunStatusPayload } from "@/lib/first-run/status";
import { ROUTES } from "@/lib/routes";

import { FIRST_RUN_API, postJson } from "./api";
import styles from "./first-run.module.css";
import { Stage } from "./Stage";
import { StepRow } from "./StepRow";
import { Strip } from "./Strip";
import { StubStep } from "./StubStep";

/**
 * A stamp, whichever side of the wire it arrived from.
 *
 * The server component hands these down as real dates; every poll after that
 * hands them down as ISO strings, because JSON has no date. The reducer
 * measures from them, so one shape has to win at the boundary — and coercing
 * here is the difference between an elapsed readout and a crash on the payoff
 * screen (D5).
 */
function toStamp(at: Date | null): Date | null {
  return at === null ? null : new Date(at);
}

/**
 * The clock's seed, read from persisted stamps and nothing else.
 *
 * It must be SSR-safe — a wall-clock reading in a state initialiser renders one
 * number on the server and a different one in the browser, which is a hydration
 * mismatch on the first paint of the screen this outcome exists for. The newest
 * moment we can PROVE had already passed is the honest floor: it never
 * overstates the wait, it is identical on both sides, and the first tick
 * replaces it a moment later.
 */
function seedClock(status: FirstRunStatusPayload): number {
  const stamps = [status.armedAt, status.retrievedAt, status.readingAt, status.endedAt];

  return stamps.reduce((newest, at) => {
    const stamp = toStamp(at);
    return stamp === null ? newest : Math.max(newest, stamp.getTime());
  }, 0);
}

/**
 * The status a route answered with, or `null` if it answered something else.
 *
 * A COERCION AT THE BOUNDARY, NOT A SECOND PARSE. The finding inside is passed
 * through untouched: the status service already validated it against the
 * rendered shape and degraded a row it could not read, and a second opinion
 * here would be a second place for the two to disagree about the same row.
 */
function readStatus(body: unknown): FirstRunStatusPayload | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const counter = record.counter;

  return typeof counter === "object" && counter !== null ? (body as FirstRunStatusPayload) : null;
}

/** The poll. A dropped connection resolves to `null` and never throws. */
async function pollStatus(): Promise<FirstRunStatusPayload | null> {
  try {
    const response = await fetch(FIRST_RUN_API.status);
    return response.ok ? readStatus((await response.json()) as unknown) : null;
  } catch {
    return null;
  }
}

interface FirstRunClientProps {
  /** The server's reconciled answer. The authority until a poll lands. */
  readonly status: FirstRunStatusPayload;
  /** Phase A — the five rows, server-rendered and handed in whole. */
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

  const armedOnArrival = useRef(armed);
  const handle = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const busy = useRef(false);

  useEffect(() => {
    // The wait is over, or was never started. A ticking interval past a
    // terminal state is not merely a leak — it keeps re-rendering the payoff
    // underneath somebody who has stayed on the screen to read it.
    if (!armed || terminal) {
      clearInterval(handle.current);
      return undefined;
    }

    // ONE interval carrying both jobs, so the readout and the facts beside it
    // can never drift apart. The guard drops a tick rather than stacking a
    // second request on a slow answer.
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

    // The first tick is a whole second away. This closes the gap for somebody
    // who reloaded mid-wait, without a wall-clock reading in the render path.
    const first = setTimeout(() => setNowMs(Date.now()), 0);

    return () => {
      clearTimeout(first);
      clearInterval(handle.current);
    };
  }, [armed, terminal]);

  // T6's overlap, and the whole reason it exists: a frame where neither the
  // sequence nor the strip is on screen reads as a page load, and a page load
  // here reads as the product crashing at its most important moment.
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

    // The route stamped the origin before it answered, so the clock is already
    // durable by the time the wait first paints.
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

    // The one action that retires the surface. After this the landing page
    // renders no way back, and this route redirects away from itself.
    router.push(ROUTES.home);
  }

  const connectionState = current.counter.state;
  const sequenceFacts: StepSequenceFacts = {
    connectionStatus: connectionState.status === "not_connected" ? null : connectionState.status,
    slackConnected: current.channelId !== null,
    slackSkipped: current.slackSkippedAt !== null,
    // A failed test post is a client fact, and this island observed none.
    slackTestPostFailed: false,
    armedAt: facts.armedAt,
    // UX row 25: every step at its resolved state, and no form re-opens.
    reopenedReadOnly: true,
  };

  const resolved = new Map(deriveStepStates(sequenceFacts).map((view) => [view.id, view]));

  return (
    <Stack gap="md">
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
            {STEP_DESCRIPTORS.map((descriptor) => {
              const view = resolved.get(descriptor.id);
              if (view === undefined) {
                return null;
              }

              if (descriptor.kind === "coming-next") {
                return <StubStep key={descriptor.id} step={descriptor} />;
              }

              // Closed, every one of them. A re-opened sequence is a record of
              // what was done, not an invitation to do it again.
              return (
                <StepRow
                  key={descriptor.id}
                  ordinal={descriptor.ordinal}
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

      {armed ? null : (
        <Group gap="sm" wrap="wrap">
          <Button
            onClick={() => void startWatching()}
            loading={pending}
            className={styles.action}
            style={tapTargetStyle}
            w={{ base: "100%", xs: "auto" }}
          >
            {ONBOARDING_MESSAGES.startWatching}
          </Button>
        </Group>
      )}

      {/* EC-O5 rides the poll, not a client flag: the route is the authority on
          it and re-answers every tick, so a row that becomes readable clears the
          sentence on its own. */}
      {armed ? (
        <Stage
          facts={facts}
          nowMs={nowMs}
          channelId={current.channelId}
          findingUnavailable={current.findingUnavailable === true}
        />
      ) : null}

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
