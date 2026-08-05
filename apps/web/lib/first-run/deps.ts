import type { CreateSourceFn, ScopedDb } from "@growthmind/db";
import { createSlackConnectionsRepo } from "@growthmind/db";
import type { DiscoveryInput, DiscoveryResult } from "@growthmind/adapters";
import type {
  AgentProviderId,
  CredentialKey,
  CredentialKeyResolution,
  DeliveryPoster,
  InterestProviderId,
  WebEnv,
  TenantContext,
} from "@growthmind/shared";
import { logger, parseWebEnv, resolveCredentialKey } from "@growthmind/shared";
import {
  createPostHogSessionSource,
  createSlackDeliveryPoster,
  discoverProjects,
} from "@growthmind/adapters";

import { createPostHogAdapterDeps } from "@/lib/adapter-deps";
import { whenCredentialResolved } from "@/lib/credential-port";
import { getDb } from "@/lib/db";
import { getPostHogClient } from "@/lib/posthog-server";
import { listChannels, type SlackChannelChoice } from "@/lib/slack/channels";
import { getTenantContext } from "@/lib/tenant";

export type FirstRunPosterFor = (ctx: TenantContext) => Promise<DeliveryPoster | null>;

// `DiscoveryInput`'s `host: null` is load-bearing: it selects the walk over the
// known regions rather than one request at an address a customer typed.
export type FirstRunDiscoverProjects = (input: DiscoveryInput) => Promise<DiscoveryResult>;

export type FirstRunChannelListingRefusal =
  "no_connection" | "unreadable_credential" | "not_authorised" | "call_failed";

export type FirstRunChannelListing =
  | { readonly ok: true; readonly channels: readonly SlackChannelChoice[] }
  | { readonly ok: false; readonly code: FirstRunChannelListingRefusal };

// AD-20: a per-org port built in this composition root, exactly like
// `posterFor`. The route never sees the bot token and cannot.
export type FirstRunChannelsFor = (ctx: TenantContext) => Promise<FirstRunChannelListing>;

// AD-6's event seam: the interest route fires it only when the insert claimed.
export type RecordInterestNoted = (input: {
  readonly organizationId: string;
  readonly userId: string;
  readonly provider: InterestProviderId;
}) => void;

// D-14's seam, the sibling of `recordInterestNoted`. First contact fires nothing:
// the stamp is the observation, and the panel already reads it.
export type RecordAgentKeyMinted = (input: {
  readonly organizationId: string;
  readonly provider: AgentProviderId;
}) => void;

export interface FirstRunRouteDeps {
  readonly db: ScopedDb;

  readonly tenant: () => Promise<TenantContext | null>;

  readonly now: () => Date;

  readonly createSource?: CreateSourceFn | undefined;

  readonly discoverProjects?: FirstRunDiscoverProjects | undefined;

  readonly credentialKey?: CredentialKeyResolution | undefined;

  readonly poster?: DeliveryPoster | undefined;

  readonly posterFor?: FirstRunPosterFor | undefined;

  readonly channelsFor?: FirstRunChannelsFor | undefined;

  readonly recordInterestNoted?: RecordInterestNoted | undefined;

  readonly recordAgentKeyMinted?: RecordAgentKeyMinted | undefined;

  // AD-8's one seam: the routes have to be drivable with no network.
  readonly fetch?: typeof globalThis.fetch | undefined;
}

function createSourceWith(key: CredentialKey): CreateSourceFn {
  return (config) => createPostHogSessionSource(config, createPostHogAdapterDeps(key));
}

// Built only when the key resolves: the identity hmac comes from it (M-1).
function discoverProjectsWith(key: CredentialKey): FirstRunDiscoverProjects {
  return (input) => discoverProjects(input, createPostHogAdapterDeps(key));
}

type OrgSlackCredential =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly code: "no_connection" | "unreadable_credential" };

// Shared by `makePosterFor` and `makeChannelsFor`: both need the org's stored
// Slack credential opened the same way, here and nowhere else (AD-20, D7).
async function openOrgSlackCredential(
  db: ScopedDb,
  ctx: TenantContext,
  key: CredentialKey,
): Promise<OrgSlackCredential> {
  const opened = await createSlackConnectionsRepo(db, ctx).openCredentialForOrg(key);

  if (opened === null) {
    return { ok: false, code: "no_connection" };
  }

  if (!opened.ok) {
    logger.error(
      `onboarding composition: org ${ctx.organizationId} has a stored delivery credential this ` +
        `installation cannot open (${opened.reason}) — it must be reconnected`,
    );
    return { ok: false, code: "unreadable_credential" };
  }

  return { ok: true, token: opened.value };
}

// A poster per organization, keyed by the context and nothing else (D7). This
// file is the composition root: no route, page or service may open a credential
// itself (AD-20). Fails closed, and never names the ciphertext.
function makePosterFor(db: ScopedDb, env: WebEnv): FirstRunPosterFor {
  return whenCredentialResolved<TenantContext, DeliveryPoster | null>(
    resolveCredentialKey(env),
    "onboarding composition",
    "no delivery channel can be opened",
    null,
    (key) => async (ctx) => {
      const credential = await openOrgSlackCredential(db, ctx, key);
      if (!credential.ok) {
        return null;
      }
      return createSlackDeliveryPoster({ botToken: credential.token }, { fetch: globalThis.fetch });
    },
  );
}

// The sibling of `makePosterFor`, one screen earlier: a channel lister per
// organization, with the credential opened here and nowhere else (AD-20, D7).
// Nothing is stored (AD-7) — the list is fetched at pick time, so a channel
// created a minute ago is pickable.
function makeChannelsFor(
  db: ScopedDb,
  resolution: CredentialKeyResolution,
  fetchImpl: typeof globalThis.fetch,
): FirstRunChannelsFor {
  return whenCredentialResolved<TenantContext, FirstRunChannelListing>(
    resolution,
    "onboarding composition",
    "no workspace's channels can be read",
    { ok: false, code: "unreadable_credential" },
    (key) => async (ctx) => {
      const credential = await openOrgSlackCredential(db, ctx, key);
      if (!credential.ok) {
        return { ok: false, code: credential.code };
      }

      const listed = await listChannels(credential.token, { fetch: fetchImpl });

      // The token went one call into the adapter; `{ id, name }` crosses back.
      return listed.ok ? { ok: true, channels: listed.channels } : { ok: false, code: listed.code };
    },
  );
}

// Two ways in, one composition: both land on `makeChannelsFor`, so there is no
// arrangement of deps under which a handler opens a credential itself.
export function resolveChannelsFor(deps: FirstRunRouteDeps): FirstRunChannelsFor {
  return (
    deps.channelsFor ??
    makeChannelsFor(
      deps.db,
      deps.credentialKey ?? resolveCredentialKey(parseWebEnv(process.env)),
      deps.fetch ?? globalThis.fetch,
    )
  );
}

// The wire, in one function, so every route composes identically. The env is
// read per request rather than at module load.
export function resolveFirstRunDeps(db: ScopedDb = getDb()): FirstRunRouteDeps {
  const env = parseWebEnv(process.env);
  const credentialKey = resolveCredentialKey(env);

  return {
    db,
    tenant: getTenantContext,
    now: () => new Date(),
    createSource: credentialKey.ok ? createSourceWith(credentialKey.key) : undefined,
    discoverProjects: credentialKey.ok ? discoverProjectsWith(credentialKey.key) : undefined,
    credentialKey,
    posterFor: makePosterFor(db, env),
    channelsFor: makeChannelsFor(db, credentialKey, globalThis.fetch),
    // Null-safe when unconfigured, and no PII: the one property is the provider
    // id (growthmind-instrument discipline). The distinct id is the org because
    // the demand is the org's (AD-3) — no user identifier rides the event.
    recordInterestNoted: ({ organizationId, provider }) => {
      const posthog = getPostHogClient();
      if (!posthog) return;
      posthog.capture({
        distinctId: organizationId,
        event: "registered interest in a coming-soon connection",
        properties: { provider },
      });
    },
    recordAgentKeyMinted: ({ organizationId, provider }) => {
      const posthog = getPostHogClient();
      if (!posthog) return;
      posthog.capture({
        distinctId: organizationId,
        event: "created a key for a coding assistant",
        properties: { provider },
      });
    },
    fetch: globalThis.fetch,
  };
}
