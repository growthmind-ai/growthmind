// THE ONE SEAM EVERY ONBOARDING ROUTE TAKES BESIDES ITS `Request` (O-008,
// AD-16, AD-20).
//
// ###########################################################################
// # WHAT IS DELIBERATELY ABSENT FROM `FirstRunRouteDeps`, AND IS THE WHOLE
// # POINT: THERE IS NO `projectId` AND NO `organizationId` ON IT.
// #
// # `ensureProject(db, ctx)` derives the project from the context, and the
// # context comes from `tenant()`, which reads the session. A VALUE THAT
// # CANNOT ARRIVE CANNOT BE MIS-SCOPED (AD-16's rationale). A field added
// # here later re-opens exactly the hole AD-16 closed, so the absence is the
// # contract and not an omission.
// ###########################################################################
//
// ── WHY THE SEAM EXISTS AT ALL ──────────────────────────────────────────────
//
// Modelled on `apps/web/app/api/mcp/route.ts`'s `resolveMcpDeps(db = getDb())`
// and for the same reason its header gives: the decision lives in a handler
// that takes its effects as ports, "so the whole surface is driven end to end
// through its real entry point". This surface needs it for one reason the
// machine surface does not have: **tenancy comes from a SESSION, and
// `getTenantContext()` reads `next/headers`, which has no request scope in a
// bare test process and therefore resolves to `null` there, permanently**
// (`apps/web/lib/tenant.ts` documents that; `redirects.test.ts` depends on it).
// A signed-in route that cannot be handed a tenant context cannot be
// behaviourally tested at all.
import type { CreateSourceFn, ScopedDb } from "@growthmind/db";
import { createSlackConnectionsRepo } from "@growthmind/db";
import type { DiscoveryInput, DiscoveryResult } from "@growthmind/adapters";
import type {
  CredentialKey,
  CredentialKeyResolution,
  DeliveryPoster,
  ServerEnv,
  TenantContext,
} from "@growthmind/shared";
import { deriveIdentityHmacKey, parseServerEnv, resolveCredentialKey } from "@growthmind/shared";
import {
  createPostHogSessionSource,
  createSlackDeliveryPoster,
  discoverProjects,
} from "@growthmind/adapters";

import { getDb } from "@/lib/db";
import { listChannels, type SlackChannelChoice } from "@/lib/slack/channels";
import { getTenantContext } from "@/lib/tenant";

/**
 * A poster bound to ONE organization's stored credential, or `null`.
 *
 * The same shape `worker/src/index.ts`'s `makePosterFor` returns, and for the
 * identical reason stated there: `createSlackDeliveryPoster` binds one
 * workspace's bearer token at construction and `PostRequest` carries no
 * organization, so a single poster cannot serve a multi-org installation.
 *
 * `null` means this organization has no active connection — an ordinary
 * answer, never a fault.
 */
export type FirstRunPosterFor = (ctx: TenantContext) => Promise<DeliveryPoster | null>;

/**
 * The project-discovery probe, with its effects already bound.
 *
 * The same shape `CreateSourceFn` has, and for the same reason its own header
 * gives: the adapter's `discoverProjects(input, deps)` needs a real `fetch`,
 * and a handler that constructed one itself could not be driven end to end in a
 * bare test process. So the composition root closes the effects over the call
 * and the handler is handed something whose only verb is "ask".
 *
 * `DiscoveryInput`'s `host: string | null` is the adapter's own signature and
 * the `null` is load-bearing — it selects the walk over the known regions
 * rather than one guarded request at an address a customer typed. The handler
 * translates its optional field to `null`; `undefined` is neither branch.
 */
export type FirstRunDiscoverProjects = (input: DiscoveryInput) => Promise<DiscoveryResult>;

/**
 * Why a channel list could not be produced. Four codes, four next actions.
 *
 * `no_connection` and `unreadable_credential` are the two this file's own
 * composition can answer without asking Slack anything; the other two are
 * `listChannels`' own vocabulary, passed through unchanged rather than
 * re-derived, so the adapter stays the one place that decides what a vendor
 * error means.
 */
export type FirstRunChannelListingRefusal =
  "no_connection" | "unreadable_credential" | "not_authorised" | "call_failed";

export type FirstRunChannelListing =
  | { readonly ok: true; readonly channels: readonly SlackChannelChoice[] }
  | { readonly ok: false; readonly code: FirstRunChannelListingRefusal };

/**
 * AD-20's answer to "who opens the credential for the channel picker".
 *
 * ###########################################################################
 * # THE ROUTE NEVER SEES THE BOT TOKEN, AND CANNOT.
 * #
 * # Task 5.4 originally told the channels route to open the credential
 * # itself. That contradicts AD-20 and `slack-connections.repo.ts:28-31`,
 * # which reserve `openCredentialForOrg` for the delivery composition root
 * # and state plainly that no route, page or service may call it. The ADD
 * # resolved the conflict in AD-7's own text: AD-20 wins, and the route takes
 * # a per-org port built HERE, exactly as it takes `posterFor`.
 * #
 * # So the shape is `posterFor`'s: one function per organization, with the
 * # credential opened inside this file and nothing decrypted crossing back
 * # out. What the route receives can list channels and cannot do anything
 * # else — most particularly, it cannot hand a token to a response.
 * ###########################################################################
 */
export type FirstRunChannelsFor = (ctx: TenantContext) => Promise<FirstRunChannelListing>;

/**
 * Everything an onboarding handler needs that is not its `Request`.
 *
 * The optional effect ports are the ones only some handlers have, and each is
 * the SHIPPED type rather than a new port (AD-20, FR-O11's "no new poster"):
 * `CreateSourceFn` is `packages/db`'s own injection point,
 * `CredentialKeyResolution` is the inherited insecure-defaults gate's result,
 * `DeliveryPoster` is the delivery lane's port verbatim, and
 * `discoverProjects` is the adapter's own exported call with its effects bound.
 * The list is deliberately uncounted: a comment that says how many there are is
 * one the next route makes wrong with nothing failing.
 */
export interface FirstRunRouteDeps {
  readonly db: ScopedDb;
  /** THE ONLY TENANCY INPUT ON THIS SURFACE. `null` ⇒ 401, never data. */
  readonly tenant: () => Promise<TenantContext | null>;
  /** Injected so a persisted stamp is assertable without sleeping on a clock. */
  readonly now: () => Date;
  /** The analytics connect step only — the shipped `CreateSourceFn`. */
  readonly createSource?: CreateSourceFn | undefined;
  /** The analytics discover step only — the shipped `discoverProjects`, bound. */
  readonly discoverProjects?: FirstRunDiscoverProjects | undefined;
  /** The inherited insecure-defaults gate, checked FIRST and UNCONDITIONALLY. */
  readonly credentialKey?: CredentialKeyResolution | undefined;
  /**
   * A poster already bound to this caller's organization. Supplied directly by
   * a test; in production it is built per request by `posterFor` below,
   * because the credential can only be opened once the session has named an
   * organization.
   */
  readonly poster?: DeliveryPoster | undefined;
  /** The production route to a poster. See `FirstRunPosterFor`. */
  readonly posterFor?: FirstRunPosterFor | undefined;
  /** The two channel steps only — AD-20's per-org port. See
   *  `FirstRunChannelsFor`, and `resolveChannelsFor` for how a handler takes
   *  it whether or not the composition root bound one. */
  readonly channelsFor?: FirstRunChannelsFor | undefined;
  /**
   * AD-8's ONE new seam, and deliberately one rather than a port per vendor
   * call.
   *
   * A port per call (`exchangeCode`, `listChannels`) would have pinned this
   * sprint's internal decomposition as well as its behaviour. What the routes
   * actually need is the ability to be driven with no network — without it,
   * "a mismatched state costs zero outbound calls" is unprovable, and a test
   * that cannot fail is not a test. `resolveFirstRunDeps` threads
   * `globalThis.fetch` in, the same way it already does for the PostHog source.
   */
  readonly fetch?: typeof globalThis.fetch | undefined;
}

/**
 * How long the analytics adapter may sleep inside one request before it gives
 * up rather than backing off further.
 *
 * A poll run has a budget; a web request has a person waiting. Without a
 * ceiling the adapter's 429 backoff would hold the connect step open for as
 * long as the vendor asked for, and a founder would watch a spinner with no
 * ending. Exceeding it surfaces as `rate_limited`, which has its own sentence
 * and its own next step.
 */
const CONNECT_BACKOFF_CEILING_MS = 5_000;

/**
 * THE ONE PLACE THE ANALYTICS VENDOR IS NAMED IN THIS PACKAGE.
 *
 * `packages/db` never constructs a vendor client — that is what keeps the data
 * layer independent of `packages/adapters` — so the factory is injected from
 * here, exactly as `worker/src/tasks/session-source-poll.ts` injects it there.
 *
 * The identity HMAC key is derived from the installation's already-resolved
 * credential key (security audit M-1), never read from an environment variable
 * by the adapter itself, and derived once per composition rather than per
 * event.
 */
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

/**
 * Project discovery, with the adapter's effects closed over.
 *
 * BUILT ONLY WHEN THE CREDENTIAL KEY RESOLVES, exactly as `createSource` is,
 * and the shared gate is the decision rather than an accident of typing.
 * `PostHogSourceDeps` is one type for the whole adapter, so an identity hmac
 * key is required here even though a list of project names carries no identity
 * to hash; deriving it from the installation's already-resolved credential key
 * (security audit M-1) rather than minting a second source of key material
 * means the port exists exactly when this installation can safely store the key
 * the founder is about to attach. An installation that cannot has nothing to
 * gain from discovering a project list: the connect step immediately after it
 * refuses `misconfigured` anyway, and finding out then costs the founder a key
 * already spent against their vendor and a choice already made.
 *
 * `sleep` is supplied and never called. Discovery runs while a person watches a
 * form, so the adapter treats a 429 as an immediate named refusal there rather
 * than backing off — its own suite asserts the recorded sleeps are exactly `[]`.
 */
function discoverProjectsWith(key: CredentialKey): FirstRunDiscoverProjects {
  const identityHmacKey = deriveIdentityHmacKey(key);

  return (input) =>
    discoverProjects(input, {
      fetch: globalThis.fetch,
      sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
      random: () => Math.random(),
      identityHmacKey,
    });
}

/**
 * A poster per organization, built from that organization's stored envelope.
 *
 * THE CREDENTIAL IS KEYED BY THE CONTEXT AND BY NOTHING ELSE (D7).
 * `createSlackConnectionsRepo(db, ctx)` takes the organization at construction
 * and `openCredentialForOrg` accepts no id, so there is no route by which a
 * value travelling on a request could select a credential.
 *
 * ── WHY `openCredentialForOrg` IS CALLED HERE AND NOWHERE ELSE ──────────────
 * AD-20 puts that door in the composition root and states that no route, page
 * or service may call it. THIS FILE IS THIS APP'S COMPOSITION ROOT for the
 * surface — the analogue of `worker/src/index.ts` — and the handlers take the
 * opened poster as a port. No handler names the repository method, and the
 * decrypted token lives for the lifetime of one poster and travels one
 * function call into the adapter.
 *
 * FAILS CLOSED, and the two failures stay apart: a resolution refusal means no
 * poster is ever built on this installation, and an envelope this installation
 * can no longer open names the reason and never the ciphertext.
 */
function makePosterFor(db: ScopedDb, env: ServerEnv): FirstRunPosterFor {
  const resolution = resolveCredentialKey(env);

  if (!resolution.ok) {
    console.error(
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
      console.error(
        `onboarding composition: org ${ctx.organizationId} has a stored delivery credential this ` +
          `installation cannot open (${opened.reason}) — it must be reconnected`,
      );
      return null;
    }

    return createSlackDeliveryPoster({ botToken: opened.value }, { fetch: globalThis.fetch });
  };
}

/**
 * A channel lister per organization, built from that organization's stored
 * envelope. The sibling of `makePosterFor`, one screen earlier in the flow.
 *
 * THE CREDENTIAL IS OPENED HERE AND NOWHERE ELSE, for the reason
 * `FirstRunChannelsFor` states at length. `createSlackConnectionsRepo(db, ctx)`
 * takes the organization at construction and `openCredentialForOrg` accepts no
 * id, so no value travelling on a request can select a credential (D7).
 *
 * NOTHING IS STORED (AD-7). The list is fetched at pick time and handed
 * straight back — no table, no sync, and therefore no staleness. A channel
 * created a minute ago is pickable because there is nothing to invalidate.
 *
 * FAILS CLOSED, with the two installation failures kept apart from the two
 * vendor ones: an unresolvable key means no listing on this installation at
 * all, and an envelope we can no longer open names the reason and never the
 * ciphertext.
 */
function makeChannelsFor(
  db: ScopedDb,
  resolution: CredentialKeyResolution,
  fetchImpl: typeof globalThis.fetch,
): FirstRunChannelsFor {
  if (!resolution.ok) {
    console.error(
      `onboarding composition: the credential key could not be resolved (${resolution.reason}), ` +
        `so no workspace's channels can be read on this installation until it is configured`,
    );
    return () => Promise.resolve({ ok: false, code: "unreadable_credential" });
  }

  const key = resolution.key;

  return async (ctx) => {
    const opened = await createSlackConnectionsRepo(db, ctx).openCredentialForOrg(key);

    if (opened === null) {
      return { ok: false, code: "no_connection" };
    }

    if (!opened.ok) {
      console.error(
        `onboarding composition: org ${ctx.organizationId} has a stored delivery credential this ` +
          `installation cannot open (${opened.reason}) — it must be reconnected`,
      );
      return { ok: false, code: "unreadable_credential" };
    }

    const listed = await listChannels(opened.value, { fetch: fetchImpl });

    // The token went one function call into the adapter and is not in scope
    // beyond this line. What crosses back is `{ id, name }` and a refusal code.
    return listed.ok ? { ok: true, channels: listed.channels } : { ok: false, code: listed.code };
  };
}

/**
 * The channels port a handler actually uses.
 *
 * TWO WAYS IN, ONE COMPOSITION. `resolveFirstRunDeps` binds `channelsFor` for
 * production; a test hands the raw deps a route needs and no port, exactly as
 * it hands `poster` rather than `posterFor` to the test-message route. Both
 * paths land on `makeChannelsFor` in this file, so there is no arrangement of
 * deps under which a handler opens a credential itself.
 *
 * `deps.fetch ?? globalThis.fetch` is the AD-8 seam: the injected one when a
 * caller supplied it, the real one in production.
 */
export function resolveChannelsFor(deps: FirstRunRouteDeps): FirstRunChannelsFor {
  return (
    deps.channelsFor ??
    makeChannelsFor(
      deps.db,
      deps.credentialKey ?? resolveCredentialKey(parseServerEnv(process.env)),
      deps.fetch ?? globalThis.fetch,
    )
  );
}

/**
 * The wire, in one function — exported so it has a test, and so every route on
 * this surface composes identically rather than each assembling its own.
 *
 * The database is a DEFAULTED PARAMETER rather than a hard-coded call, the same
 * seam `resolveMcpDeps` uses: `getDb()` is still what every request gets,
 * because the mounted verbs call this with no argument, and it is resolved per
 * request rather than at module load.
 *
 * `createSource` and `discoverProjects` are built ONLY when the key resolves.
 * That is not a convenience: the identity HMAC key is derived from the same
 * material, so an installation that cannot store a credential safely also has
 * nothing to hash an identity with — and each handler's own first gate refuses
 * it anyway, before any request is made and before any row is written.
 */
export function resolveFirstRunDeps(db: ScopedDb = getDb()): FirstRunRouteDeps {
  const env = parseServerEnv(process.env);
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
    fetch: globalThis.fetch,
  };
}
