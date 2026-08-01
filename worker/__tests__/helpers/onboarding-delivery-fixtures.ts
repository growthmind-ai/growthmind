// O-008 Wave 0e — shared fixtures for the two delivery suites
// (`delivery-composition.test.ts`, task 0e.3, and
// `delivery-wire-end-to-end.test.ts`, task 0e.4).
//
// WHY A NEW FILE RATHER THAN AN EXTENSION OF `wire-fixtures.ts`. That file is
// O-003 Wave 0b's, and its own header states the rule it was written under:
// "a lane that reaches into another lane's helper file re-couples them". Its
// org/project/connection seeders ARE reused below — they are this package's
// established way to get a tenant into a `createTestDb()` — but everything
// O-008 adds lives here, so the O-003 lane's file is not edited by a later
// sprint's wave. ADD §5 grants Wave 0 "new files only" under `worker/__tests__/`.
//
// WHY THE TWO SUITES SHARE THIS RATHER THAN EACH CARRYING A COPY. Both seed a
// `slack_connections` row that does not exist on this tree, both build the
// deps shape AD-13 changes, and both need a recording poster. Two private
// copies of that is the D11 duplication `module-under-construction.ts`'s header
// exists to prevent, one package over.
//
// THE REPOSITORY IS PUBLIC. Every token, channel id and email below is an
// obviously-fake placeholder. Nothing here is or resembles real credential
// material.
import { randomUUID } from "node:crypto";

import { schema } from "@growthmind/db";
import type { PersistFindingInput } from "@growthmind/db";
import { createAnalysisRunsRepo, createFindingsRepo } from "@growthmind/db";
import type { TestDb } from "@growthmind/db/testing";
import { credentialAad, encryptSecret, keyIdOf, type CredentialKey } from "@growthmind/shared";
import type {
  DeliveryPoster,
  PostFailureCode,
  PostRequest,
  PostResult,
  TenantContext,
} from "@growthmind/shared";

import { assertUnderConstruction } from "../../../packages/shared/__tests__/onboarding/module-under-construction";
import type {
  DeliveriesRepoFor,
  DeliveryLaneSource,
  DeliveryLogger,
} from "../../src/tasks/delivery-tick";

// ===========================================================================
// THE CONTRACT MIRROR — AD-13, copied verbatim from the ADD's own TypeScript
// ===========================================================================

/** ADD AD-13, line 422 — copied verbatim. */
export type MirrorDeliveryPosterFor = (ctx: TenantContext) => Promise<DeliveryPoster | null>;

/**
 * ADD AD-13, lines 424-430 — copied verbatim.
 *
 * `poster: DeliveryPoster` BECOMES `posterFor: DeliveryPosterFor`, and that is
 * the whole decision. Correction C-C: `createSlackDeliveryPoster` binds ONE
 * workspace's bearer token AT CONSTRUCTION, and `PostRequest` carries
 * `channelId`, `blocks`, `fallbackText` and NO ORGANIZATION — so one poster
 * instance can serve exactly one org's token while `runDeliveryTick` iterates
 * lanes across every org.
 *
 * THE REJECTED ALTERNATIVE IS A D7 HAZARD BY CONSTRUCTION: a dispatching poster
 * mapping `channelId` → org would key a CREDENTIAL LOOKUP on a value that
 * TRAVELS WITH THE MESSAGE. The credential is resolved from the tenant context,
 * never from anything the message carries.
 *
 * Written by explicit enumeration rather than as
 * `Omit<DeliveryTickDeps, "poster"> & {...}`: an `Omit` would silently re-admit
 * a `poster` field somebody re-adds later, and the absence of that field is the
 * contract.
 */
export interface MirrorDeliveryTickDeps {
  lanes: DeliveryLaneSource;
  deliveriesFor: DeliveriesRepoFor;
  posterFor: MirrorDeliveryPosterFor;
  now: () => Date;
  logger: DeliveryLogger;
}

/** AD-14, line 451 — the composition's own shape once the wire lands. */
export interface MirrorDeliveryComposition {
  lanes: DeliveryLaneSource;
  posterFor: MirrorDeliveryPosterFor;
}

/** AD-14, line 446 — `resolveDeliveryComposition` becomes `async`. */
export type MirrorResolveDeliveryComposition = () => Promise<MirrorDeliveryComposition | null>;

/** AD-14, line 451 — `makePosterFor(db, env)`. The `env` parameter is what
 *  `resolveCredentialKey` needs in order to open the stored envelope (Wave 5). */
export type MirrorMakePosterFor = (db: unknown, env: unknown) => MirrorDeliveryPosterFor;

// ===========================================================================
// Reaching a table a later wave creates
// ===========================================================================

/** The parameter type `db.insert()` accepts, derived from the shipped handle
 *  rather than imported — `worker` does not depend on `drizzle-orm` directly
 *  (see `wire-fixtures.ts`'s header) and adding it for a test would be a real
 *  dependency for a fake reason. */
export type AnyTable = Parameters<TestDb["insert"]>[0];

/**
 * Resolve a drizzle table a LATER WAVE adds to the schema barrel, converting
 * its absence into the same named diagnostic every other Wave 0e red carries.
 *
 * Without this, seeding an absent table is either a TS2339 on
 * `schema.slackConnections` (which takes the typecheck gate down) or a raw
 * Postgres `relation "slack_connections" does not exist` (which reads as a
 * broken migration rather than an unwritten one).
 */
export function tableUnderConstruction(name: string, ownedBy: string): AnyTable {
  const table = (schema as unknown as Record<string, unknown>)[name];

  assertUnderConstruction(table !== undefined, {
    contract: `the \`${name}\` table on the @growthmind/db schema barrel`,
    ownedBy,
  });

  return table as AnyTable;
}

// ===========================================================================
// Obviously-fake credential material
// ===========================================================================

/**
 * A deterministic 32-byte AES key.
 *
 * NOT REAL KEY MATERIAL, and it never can be: this repository is public. The
 * bytes are `0..31` rather than all-zero so an assertion that the key id is not
 * a prefix of the key material is testing something — an all-zero key encodes
 * to a long run of `A`s in base64, which makes any near-miss look like a pass.
 */
export const SLACK_TEST_KEY: CredentialKey = {
  bytes: Uint8Array.from({ length: 32 }, (_, index) => index),
};

/** Shaped like a Slack bot token so a leak would be recognisable in a diff, and
 *  obviously invalid so it can never authenticate anywhere. */
export const FAKE_BOT_TOKEN = "xoxb-fixture-only-never-a-real-token";

/**
 * AD-20: the AAD's second argument is the LITERAL `"slack"`, never a project id
 * — this connection is ORG-SCOPED and has no project.
 */
export function slackEnvelopeFor(organizationId: string): { ciphertext: string; keyId: string } {
  return {
    ciphertext: encryptSecret(
      FAKE_BOT_TOKEN,
      SLACK_TEST_KEY,
      credentialAad(organizationId, "slack"),
    ),
    keyId: keyIdOf(SLACK_TEST_KEY),
  };
}

// ===========================================================================
// Seeders
// ===========================================================================

export interface SeedSlackConnectionParams {
  organizationId: string;
  /** FR-O13: the ONE delivery address, read off this row and never off a
   *  payload. Distinct per org in every multi-org fixture, so "org A's finding
   *  reached org B's channel" is a detectable event rather than an invisible
   *  one. */
  channelId: string;
  isActive?: boolean;
  connectedAt?: Date;
}

/**
 * One org-scoped Slack connection. ADD Wave 2 creates the table; the column
 * list below is derived from AD-8 and AD-20 and is FLAGGED as a derivation —
 * Wave 2 may name a column differently, in which case this seeder is the one
 * place that changes for both suites.
 */
export async function seedSlackConnection(
  db: TestDb,
  params: SeedSlackConnectionParams,
  ownedBy: string,
): Promise<{ id: string; channelId: string }> {
  const envelope = slackEnvelopeFor(params.organizationId);
  const id = randomUUID();

  await db.insert(tableUnderConstruction("slackConnections", ownedBy)).values({
    id,
    organizationId: params.organizationId,
    channelId: params.channelId,
    credentialCiphertext: envelope.ciphertext,
    credentialKeyId: envelope.keyId,
    isActive: params.isActive ?? true,
    connectedAt: params.connectedAt ?? new Date(),
  } as never);

  return { id, channelId: params.channelId };
}

export interface SeedFindingParams {
  projectId: string;
  surface?: string;
  headline?: string;
  context?: readonly string[];
  signature?: string;
  at: Date;
}

/**
 * A persisted finding, written through the REAL repositories against real SQL.
 *
 * Deliberately NOT a hand-built insert: `findings.run_id` is a RESTRICT FK onto
 * `analysis_runs`, so a hand-written row either violates the constraint or
 * quietly invents a run that never existed. Going through `open()` and
 * `persist()` means the fixture is a row the pipeline could actually have
 * produced — which is the difference between proving the delivery wire and
 * proving this file's ability to write SQL.
 */
export async function seedFinding(
  db: TestDb,
  ctx: TenantContext,
  params: SeedFindingParams,
): Promise<{ findingId: string; signature: string }> {
  const runs = createAnalysisRunsRepo(db, ctx);
  const findings = createFindingsRepo(db, ctx);

  const opened = await runs.open({ projectId: params.projectId, tickAt: params.at });
  if (!opened.opened) {
    throw new Error(`seedFinding: a run is already open for project ${params.projectId}`);
  }

  const signature =
    params.signature ?? randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64);
  const surface = params.surface ?? "/checkout/payment";

  const input: PersistFindingInput = {
    projectId: params.projectId,
    runId: opened.run.id,
    signature,
    signatureVersion: 1,
    summarySource: "floor_no_key_configured",
    headline: params.headline ?? "The payment step is losing sessions",
    context: params.context ?? ["Sessions reached the payment step and left without finishing."],
    finalClass: "confusing",
    surface,
    surfaceNormalisationVersion: 1,
    counts: [
      {
        role: "reached_surface",
        numerator: 28,
        denominator: 28,
        unit: "sessions",
      },
      {
        role: "left_without_continuing",
        numerator: 3,
        denominator: 28,
        unit: "sessions",
      },
    ],
    confidenceBasis: "threshold_met",
    windowStart: new Date(params.at.getTime() - 7 * 24 * 60 * 60 * 1_000),
    windowEnd: params.at,
    evidenceShape: `{"detector":"funnel_dropoff","surface":"${surface}","v":1}`,
    evidenceShapeVersion: 1,
    resolvedModelId: null,
    tokensIn: null,
    tokensOut: null,
  } as unknown as PersistFindingInput;

  const row = await findings.persist(input);

  await runs.close({
    runId: opened.run.id,
    projectId: params.projectId,
    status: "completed",
    outcome: "produced_findings",
    stopReason: "ran_to_completion",
    finishedAt: params.at,
    modelCallsAttempted: 0,
    candidatesUnrenderable: 0,
    candidatesRefused: 0,
    resolvedModelId: null,
    tokensIn: null,
    tokensOut: null,
  } as never);

  return { findingId: row.id, signature };
}

// ===========================================================================
// The recording poster and logger
// ===========================================================================

export interface RecordingPoster extends DeliveryPoster {
  /** Every request this poster was handed, IN ORDER. The channel id on each is
   *  what makes "org A's finding never reached org B's channel" checkable. */
  readonly posted: PostRequest[];
}

/**
 * A poster that records what it was asked to send.
 *
 * NEVER THROWS BY DEFAULT — the port is contracted never to throw, so a fake
 * that did would be testing a contract violation rather than the handler. The
 * `fails` option returns the `ok: false` arm instead, which is the shape the
 * real adapter uses and the one D8's row needs.
 */
export function createRecordingPoster(
  options: {
    readonly fails?: { readonly code: PostFailureCode; readonly message: string };
    readonly throws?: boolean;
  } = {},
): RecordingPoster {
  const posted: PostRequest[] = [];
  let nextRef = 1;

  return {
    posted,
    post(request: PostRequest): Promise<PostResult> {
      posted.push(request);

      if (options.throws === true) {
        return Promise.reject(new Error("o008d-poster-threw-against-its-contract"));
      }
      if (options.fails !== undefined) {
        return Promise.resolve({
          ok: false,
          code: options.fails.code,
          message: options.fails.message,
        });
      }

      const messageRef = `o008d-ts-${String(nextRef)}`;
      nextRef += 1;
      return Promise.resolve({ ok: true, messageRef });
    },
  };
}

export interface RecordingDeliveryLogger extends DeliveryLogger {
  readonly infos: string[];
  readonly errors: string[];
  /** Every line, so a "was this said anywhere" assertion does not have to guess
   *  which severity the implementation picked. */
  lines(): string[];
}

export function createRecordingDeliveryLogger(): RecordingDeliveryLogger {
  const infos: string[] = [];
  const errors: string[] = [];
  return {
    infos,
    errors,
    lines: () => [...infos, ...errors],
    info: (message: string) => {
      infos.push(message);
    },
    error: (message: string) => {
      errors.push(message);
    },
  };
}

/**
 * A `posterFor` that RECORDS EVERY CONTEXT IT WAS ASKED ABOUT.
 *
 * The recorded contexts are how AD-13's central claim is checked: the resolver
 * is handed a tenant context and NOTHING ELSE, so there is no channel id, no
 * message and no finding anywhere in its input.
 */
export interface RecordingPosterFor {
  posterFor: MirrorDeliveryPosterFor;
  /** Every argument list the resolver was called with. */
  readonly calls: readonly unknown[][];
  /** The poster handed back for one org, so a test can read what it posted. */
  posterOf(organizationId: string): RecordingPoster | undefined;
}

export function createRecordingPosterFor(options: {
  /** Orgs with a live connection. Any other org resolves `null` — the per-org
   *  absence path AD-13 introduces, distinct from the installation-wide one. */
  readonly connectedOrgIds: readonly string[];
  readonly posterOptions?: Parameters<typeof createRecordingPoster>[0];
}): RecordingPosterFor {
  const calls: unknown[][] = [];
  const posters = new Map<string, RecordingPoster>();

  return {
    calls,
    posterOf: (organizationId) => posters.get(organizationId),
    posterFor: (...args: unknown[]) => {
      calls.push(args);
      const ctx = args[0] as TenantContext | undefined;
      const organizationId = ctx?.organizationId ?? "";

      if (!options.connectedOrgIds.includes(organizationId)) {
        return Promise.resolve(null);
      }

      let poster = posters.get(organizationId);
      if (poster === undefined) {
        poster = createRecordingPoster(options.posterOptions);
        posters.set(organizationId, poster);
      }
      return Promise.resolve(poster);
    },
  };
}
