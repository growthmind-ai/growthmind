// THE FIRST-RUN SURFACE — PHASE A (O-008, AD-17, FR-O19, FR-O21).
//
// ###########################################################################
// # THE PREAMBLE IS THE WHOLE TENANCY AND VISIBILITY STORY, IN FOUR LINES.
// #
// #   no session          -> ROUTES.signIn
// #   this user dismissed -> ROUTES.home
// #   otherwise           -> the reconciled state, server-rendered
// #
// # BOTH REDIRECTS ARE CONDITIONAL, AND THAT IS THE ONLY READING THAT
// # SATISFIES BOTH RULES AT ONCE. An always-rendering page breaks FR-O21
// # ("never linkable back to"); an unconditional redirect breaks FR-O19 ("a
// # reload must show the finding"). A 404 would be worse than either: a
// # founder pressing Back onto one reads it as the product breaking.
// #
// # DISMISSAL IS PER USER (AD-17, ESC-O2). A per-org read would lock a
// # teammate out of the only surface this sprint gives them for reading
// # connection state and disconnecting — on an act none of them performed.
// ###########################################################################
//
// ── EVERY STATE ON THIS PAGE IS DERIVED FROM PERSISTED ROWS ─────────────────
//
// There is no per-step status column anywhere in this product. The sequence is
// computed by `deriveStepStates` from connection rows, the skip stamp and the
// arm stamp, so it cannot disagree with the rows it describes and a reload
// cannot resurrect a state nothing recorded. This file stays a server
// component; the two forms are client islands beside it, and each reconciles
// by asking the server again rather than by guessing at what it just changed.
//
// ── THE SEAM WAVE 7b TAKES ──────────────────────────────────────────────────
//
// Phase B — the strip, the stage, the wait log and the finding — is a client
// concern, because it polls and it holds a clock. It arrives by wrapping the
// sequence below in that wave's client component, which folds phase A away
// once `status.armedAt` is set and renders the stage in its place. Nothing
// here needs to change shape for that: the sequence is already a subtree.
import { Container, Stack } from "@mantine/core";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { createFirstRunRepo, ensureProject } from "@growthmind/db";
import {
  COMING_NEXT_DESCRIPTORS,
  deriveStepStates,
  displayOrdinal,
  LIVE_STEP_DESCRIPTORS,
  type StepSequenceFacts,
  type StepView,
  type WorkStep,
} from "@growthmind/shared";

import { ConnectAnalyticsForm } from "@/components/first-run/ConnectAnalyticsForm";
import { ConnectSlackForm } from "@/components/first-run/ConnectSlackForm";
import { CounterGrid } from "@/components/first-run/CounterGrid";
import { FirstRunClient } from "@/components/first-run/FirstRunClient";
import { PrivacyReceipt } from "@/components/first-run/PrivacyReceipt";
import { Roadmap } from "@/components/first-run/Roadmap";
import { StepRow } from "@/components/first-run/StepRow";
import { getDb } from "@/lib/db";
import { echoFirstRunStatus, type FirstRunStatusPayload } from "@/lib/first-run/status";
import { ROUTES } from "@/lib/routes";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

interface WorkBodyInput {
  readonly step: WorkStep;
  readonly view: StepView;
  readonly status: FirstRunStatusPayload;
}

/**
 * A work step's body: its form, and — once the step has resolved — the
 * confirmations that prove it worked.
 *
 * BOTH OF STEP 2's CONFIRMATIONS RENDER IN PLACE, INSIDE THE ROW THAT CAUSED
 * THEM, and the row stays open while they do (UX row 8). A confirmation that
 * scrolls itself away has not confirmed anything.
 */
function workBody(input: WorkBodyInput): ReactNode {
  const { step, view, status } = input;

  if (step.id !== "analytics") {
    // THREE SLACK FACTS, AND THEY ARE NOT ONE FACT (AD-4 row 4, AD-6). The card
    // needs to tell "no workspace at all" from "a workspace with nowhere to
    // post", and it needs to know whether this installation has a Slack app
    // before it can offer the one-click path — neither is derivable from the
    // address, and neither may be read from the environment by a client.
    //
    // `slackWorkspaceName` is the third, and this line is the whole of its wire
    // (D11). The payload has carried it since AD-4; until it was passed here it
    // was a value the server computed for nobody, with a persistence test green
    // at one end and no sentence on any screen at the other. A producer test
    // plus a consumer test does not prove a wire — `workspace-name-wire.test.ts`
    // drives it through the real card, and this attribute is what that test is
    // about.
    return (
      <ConnectSlackForm
        step={step}
        view={view}
        channelId={status.channelId}
        slackWorkspaceAttached={status.slackWorkspaceAttached}
        slackWorkspaceName={status.slackWorkspaceName}
        slackOAuthAvailable={status.slackOAuthAvailable}
      />
    );
  }

  const state = status.counter.state;
  const connection = state.status === "not_connected" ? null : state.connection;
  const resolved = view.state === "done";

  return (
    <>
      <ConnectAnalyticsForm step={step} view={view} connectionMessage={status.connectionMessage} />
      {resolved ? <CounterGrid view={status.counter} /> : null}
      {resolved ? (
        <PrivacyReceipt
          input={{
            inferredInternalDomain: connection?.inferredInternalDomain ?? null,
            provenance: connection?.internalDomainProvenance ?? null,
          }}
        />
      ) : null}
    </>
  );
}

export default async function FirstRunPage() {
  const ctx = await getTenantContext();
  if (!ctx) {
    redirect(ROUTES.signIn);
  }

  const db = getDb();

  const dismissed = await createFirstRunRepo(db, ctx).isDismissed(ctx.userId);
  if (dismissed) {
    redirect(ROUTES.home);
  }

  const { projectId } = await ensureProject(db, ctx);
  const status = await echoFirstRunStatus(db, ctx, projectId);

  const connectionState = status.counter.state;
  const facts: StepSequenceFacts = {
    // `null` means no connection row at all, which the sequence engine reads
    // differently from a row that exists and is not attached.
    connectionStatus: connectionState.status === "not_connected" ? null : connectionState.status,
    slackConnected: status.channelId !== null,
    slackSkipped: status.slackSkippedAt !== null,
    // A failed test post is a CLIENT fact that has proved nothing; the engine
    // deliberately does not consult it, and a server render has none to offer.
    slackTestPostFailed: false,
    armedAt: status.armedAt,
    reopenedReadOnly: false,
  };

  const views = new Map(deriveStepStates(facts).map((view) => [view.id, view]));

  return (
    <Container size="sm" py="xl" px="md">
      {/* THE SEAM. Phase B — the strip, the stage, the wait log and the
          finding — is a client concern: it polls and it holds a clock. It
          arrives by wrapping the sequence below, and folds it away once
          `status.armedAt` is set. The sequence needed no reshaping to allow
          it, because it was already a subtree. */}
      <FirstRunClient status={status}>
        <Stack gap="md">
          {/* ONLY THE STEPS THAT CAN BE DONE, NUMBERED 1..n BY DISPLAY POSITION.
              The stage is not among them: it is rendered above by the client
              island, in both phases, which is the inversion this rebuild is.
              A row numbered 5 with no body was where the payoff used to sit. */}
          {LIVE_STEP_DESCRIPTORS.filter((descriptor) => descriptor.kind !== "stage").map(
            (descriptor) => {
              const view = views.get(descriptor.id);
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
                  open={view.open}
                >
                  {descriptor.kind === "work" ? workBody({ step: descriptor, view, status }) : null}
                </StepRow>
              );
            },
          )}

          {/* Under the flow, not above it. Same two sentences, same honesty,
              no longer the first thing anybody reads. */}
          <Roadmap steps={COMING_NEXT_DESCRIPTORS} />
        </Stack>
      </FirstRunClient>
    </Container>
  );
}
