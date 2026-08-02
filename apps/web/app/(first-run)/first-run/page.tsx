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
    connectionStatus: connectionState.status === "not_connected" ? null : connectionState.status,
    slackConnected: status.channelId !== null,
    slackSkipped: status.slackSkippedAt !== null,

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
