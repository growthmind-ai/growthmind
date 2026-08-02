import type { CreateSourceFn, ScopedDb } from "@growthmind/db";
import { createSlackConnectionsRepo } from "@growthmind/db";
import type {
  CredentialKey,
  CredentialKeyResolution,
  DeliveryPoster,
  ServerEnv,
  TenantContext,
} from "@growthmind/shared";
import {
  deriveIdentityHmacKey,
  logger,
  parseServerEnv,
  resolveCredentialKey,
} from "@growthmind/shared";
import { createPostHogSessionSource, createSlackDeliveryPoster } from "@growthmind/adapters";

import { getDb } from "@/lib/db";
import { getTenantContext } from "@/lib/tenant";

export type FirstRunPosterFor = (ctx: TenantContext) => Promise<DeliveryPoster | null>;

export interface FirstRunRouteDeps {
  readonly db: ScopedDb;

  readonly tenant: () => Promise<TenantContext | null>;

  readonly now: () => Date;

  readonly createSource?: CreateSourceFn | undefined;

  readonly credentialKey?: CredentialKeyResolution | undefined;

  readonly poster?: DeliveryPoster | undefined;

  readonly posterFor?: FirstRunPosterFor | undefined;
}

const CONNECT_BACKOFF_CEILING_MS = 5_000;

function createSourceWith(key: CredentialKey): CreateSourceFn {
  const identityHmacKey = deriveIdentityHmacKey(key);

  return (config) =>
    createPostHogSessionSource(config, {
      fetch: globalThis.fetch,
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
      random: () => Math.random(),
      identityHmacKey,
      deadlineExceededAfter: (ms) => ms > CONNECT_BACKOFF_CEILING_MS,
    });
}

function makePosterFor(db: ScopedDb, env: ServerEnv): FirstRunPosterFor {
  const resolution = resolveCredentialKey(env);

  if (!resolution.ok) {
    logger.error(
      `onboarding composition: the credential key could not be resolved (${resolution.reason}), ` +
        `so no delivery channel can be opened on this installation until it is configured`,
    );
    return () => Promise.resolve(null);
  }

  const key = resolution.key;

  return async (ctx) => {
    const opened = await createSlackConnectionsRepo(db, ctx).openCredentialForOrg(key);

    if (opened === null) {
      return null;
    }

    if (!opened.ok) {
      logger.error(
        `onboarding composition: org ${ctx.organizationId} has a stored delivery credential this ` +
          `installation cannot open (${opened.reason}) — it must be reconnected`,
      );
      return null;
    }

    return createSlackDeliveryPoster({ botToken: opened.value }, { fetch: globalThis.fetch });
  };
}

export function resolveFirstRunDeps(db: ScopedDb = getDb()): FirstRunRouteDeps {
  const env = parseServerEnv(process.env);
  const credentialKey = resolveCredentialKey(env);

  return {
    db,
    tenant: getTenantContext,
    now: () => new Date(),
    createSource: credentialKey.ok ? createSourceWith(credentialKey.key) : undefined,
    credentialKey,
    posterFor: makePosterFor(db, env),
  };
}
