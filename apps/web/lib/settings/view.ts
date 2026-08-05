import type { ScopedDb } from "@growthmind/db";
import { createEventsCounterService, createProviderInterestRepo } from "@growthmind/db";
import type {
  ConnectionStateStatus,
  InterestProviderId,
  InternalDomainProvenance,
  TenantContext,
} from "@growthmind/shared";
import {
  CONNECTION_STATE_MESSAGES,
  interestPingConfigured,
  parseWebEnv,
  toOnboardingCounterView,
} from "@growthmind/shared";

import { readOrFallback } from "@/lib/read-or-fallback";

import { readSlackSettings, type SlackSettingsView } from "./slack";

export interface SettingsSourceView {
  readonly status: ConnectionStateStatus;

  // All null when nothing is attached — the three travel together off one connection row,
  // so a host can never be paired with another connection's project.
  readonly host: string | null;
  readonly sourceProjectId: string | null;

  readonly inferredInternalDomain: string | null;
  readonly internalDomainProvenance: InternalDomainProvenance | null;
}

export interface SettingsView {
  readonly source: SettingsSourceView;

  readonly connectionMessage: string;
  readonly slack: SlackSettingsView;

  readonly providerInterest: readonly InterestProviderId[];
  readonly interestPingAvailable: boolean;
}

const NOTHING_ATTACHED: SettingsSourceView = {
  status: "not_connected",
  host: null,
  sourceProjectId: null,
  inferredInternalDomain: null,
  internalDomainProvenance: null,
};

// An unreadable counter degrades to "nothing attached" rather than throwing. There is no
// error boundary under `app/`, and this page is the only way to repair a connection — a
// throw here would take away the control that fixes the thing that threw.
async function readSource(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<SettingsSourceView> {
  return readOrFallback(
    async () => {
      const view = toOnboardingCounterView(
        await createEventsCounterService(db, ctx).read(projectId),
      );
      const { state } = view;

      if (state.status === "not_connected") {
        return NOTHING_ATTACHED;
      }

      return {
        status: state.status,
        host: state.connection.host,
        sourceProjectId: state.connection.sourceProjectId,
        inferredInternalDomain: state.connection.inferredInternalDomain,
        internalDomainProvenance: state.connection.internalDomainProvenance,
      };
    },
    NOTHING_ATTACHED,
    "settings: the analytics connection could not be read",
    { organizationId: ctx.organizationId },
  );
}

async function readInterest(
  db: ScopedDb,
  ctx: TenantContext,
): Promise<readonly InterestProviderId[]> {
  return readOrFallback(
    () => createProviderInterestRepo(db, ctx).listNotedProviders(),
    [],
    "settings: noted providers could not be read",
    { organizationId: ctx.organizationId },
  );
}

// Org-scoped throughout, so a teammate who ran none of setup can repair all of it.
export async function readSettingsView(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
): Promise<SettingsView> {
  const [source, slack, providerInterest] = await Promise.all([
    readSource(db, ctx, projectId),
    readSlackSettings(db, ctx),
    readInterest(db, ctx),
  ]);

  return {
    source,
    connectionMessage: CONNECTION_STATE_MESSAGES[source.status],
    slack,
    providerInterest,
    // Parsed per call so an env captured at import time cannot outlive a redeploy.
    interestPingAvailable: interestPingConfigured(parseWebEnv(process.env)),
  };
}
