// THE WAVE 0 MIRROR OF O-008'S **PERSISTENCE** CONTRACT — the `packages/db`
// sibling of `packages/shared/__tests__/onboarding/contract-shapes.ts`.
//
// WHY A SECOND MIRROR AND NOT AN EXTENSION OF THE FIRST. That file mirrors the
// shapes `packages/shared` owns, and it is imported by `packages/shared`'s own
// typecheck. The four ports below are `packages/db` types: they name `ScopedDb`
// and `TenantContext`, and `packages/shared` may not import `packages/db` at
// all (ADD §2 constraint list). Putting them there would invert the layering
// this sprint spends AD-6 preserving. So the shared mirror is IMPORTED here for
// the one shape both layers agree on — `StagePersistedFacts`, which is the
// status service's OUTPUT and the stage reducer's INPUT — and nothing is
// re-declared. That import is not incidental: it is the D11 proof in type form.
// One shape, two ends, no hand-passed field to drop on the floor.
//
// WHAT THIS MIRROR IS. Every declaration below is derived from a CITED line of
// `docs/adds/onboarding-five-steps.md` — the Wave 2 file table (§5) names each
// method, AD-7 and AD-8 name each column. Where the ADD names a method without
// declaring its parameters, the derivation is stated in a comment and the
// residual ambiguity is FLAGGED rather than resolved silently.
//
// WHAT IT CANNOT PROVE, stated plainly so nobody reads more into it: the
// loaders cast to these types, so a Wave 2 signature drift is not a compile
// error HERE. It is a runtime failure in the suite that calls it, which is the
// same guarantee the shared mirror carries and the same one Wave 2's own
// typecheck closes.
//
// WHY THIS FILE IS IN `helpers/` AND NOT A NEW `onboarding/` DIRECTORY. The
// ADD's ownership map (§5) grants Wave 0 "new files only" under
// `packages/db/__tests__/{tenancy,schema,repositories,services}/`. This is a
// cross-suite fixture consumed by three of those four, and `helpers/` is
// already this package's home for exactly that (`fixtures.ts`,
// `db-lane-fixtures.ts`). A new file here collides with no wave; `fixtures.ts`
// is NOT edited.
import type { TenantContext } from "@growthmind/shared";
import type { SQL } from "drizzle-orm";

import type { StagePersistedFacts } from "../../../shared/__tests__/onboarding/contract-shapes";
import type { ScopedDb } from "../../src/repositories/types";

export type { StagePersistedFacts };

// ---------------------------------------------------------------------------
// AD-7 — `ensureProject`
// ---------------------------------------------------------------------------

/**
 * THE PROVISIONING KEY'S ONE HOME, for the tests.
 *
 * AD-7 states the literal outright: the column is "Set ONLY by the automatic
 * first-run provisioning path, to the literal `org:<organizationId>`". It is a
 * cross-boundary literal (D9) and so has exactly one home in production too —
 * whichever line of `ensure-project.ts` mints it. This copy exists so the §9
 * row asserting determinism is a statement about the ADD rather than about
 * whatever the implementation happened to write.
 *
 * D12 NOTE, and it is the reason this key is safe where the finding signature
 * was not: its ONLY input is `organization.id`, a primary key that never
 * churns. There is no derived id, no path, no normalised serialisation — so
 * there is no ancestry to track and no fork to migrate.
 */
export function provisioningKeyFor(organizationId: string): string {
  return `org:${organizationId}`;
}

/**
 * AD-7's return shape, mirrored from `ensureOrganization`'s
 * (`packages/db/src/tenancy/ensure-organization.ts:30-32`), which AD-7 says
 * this function copies "line for line".
 *
 * UNDER-SPECIFIED, FLAGGED RATHER THAN GUESSED: the ADD writes the signature as
 * `ensureProject(db, ctx)` and never names the result. `{ projectId }` is the
 * exact analogue of `{ organizationId }` and is what every caller needs; the
 * wave that writes `ensure-project.ts` may return the whole row instead, and if
 * it does, this alias — not the assertions — is what changes.
 */
export type EnsureProjectResult = { readonly projectId: string };

/** AD-7, §5 Wave 2 table: `tenancy/ensure-project.ts` — `ensureProject(db, ctx)`. */
export type EnsureProject = (db: ScopedDb, ctx: TenantContext) => Promise<EnsureProjectResult>;

// ---------------------------------------------------------------------------
// AD-8 / AD-20 — `slack_connections`
// ---------------------------------------------------------------------------

/**
 * What a `slack_connections` read hands back.
 *
 * DELIBERATELY MINIMAL, and the omission is the contract. AD-8's table declares
 * thirteen columns; only the six below are named by a §9 row, and inventing
 * types for the health quartet would pin a shape no source states. The two
 * columns this type must NOT carry — `credential_ciphertext` and
 * `credential_key_id` — are absent here, but that absence is only a claim about
 * this file. THE ROW THAT ENFORCES IT ASSERTS AT RUNTIME, over
 * `Object.keys(result)`, because a structural type cannot refuse an extra
 * property a JavaScript object actually carries.
 *
 * Mirrors `ConnectionSummary`'s discipline
 * (`packages/db/src/repositories/project-connections.repo.ts:203-223`): built
 * field-by-field, never a spread of the row.
 */
export type SlackConnectionSummary = {
  readonly id: string;
  /** AD-8: "Stamped directly, per the `project_connections` denormalization
   *  discipline". The column every read filters on (D2). */
  readonly organizationId: string;
  /** FR-O13: the delivery address, read by the lane source, NEVER accepted
   *  from a payload. */
  readonly channelId: string;
  readonly isActive: boolean;
  /** AD-8: "exists so the test message can name who connected it (OQ-O6)". */
  readonly connectedByUserId: string | null;
  readonly connectedAt: Date;
};

/**
 * AD-8's write input.
 *
 * THE ENVELOPE ARRIVES ALREADY SEALED, exactly as it does for
 * `project_connections` (`InsertActiveConnectionInput`, same file): the caller
 * encrypts and this layer persists. AD-20 fixes what the caller must have used
 * — `credentialAad(organizationId, "slack")` — and the §9 row proves the stored
 * value round-trips under that AAD and refuses another organization's.
 *
 * UNDER-SPECIFIED, FLAGGED: §5's Wave 2 table names no service that performs
 * the Slack encryption (`connections.service.ts` is the PostHog analogue and is
 * not extended). Whoever owns that call site — a Wave 6 route helper under
 * `apps/web/lib/first-run/`, most likely — inherits AD-20, and the second
 * argument they pass is the literal `"slack"` and never a project id, because
 * this connection is org-scoped and has no project.
 */
export interface InsertActiveSlackConnectionInput {
  readonly channelId: string;
  /** The `v1.<keyId>.<iv>.<tag>.<ciphertext>` envelope. */
  readonly credentialCiphertext: string;
  /** `keyIdOf(key)` — the 8-hex fingerprint, never the key (D12). */
  readonly credentialKeyId: string;
  readonly connectedByUserId: string;
  readonly connectedAt: Date;
}

/**
 * §5's Wave 2 table: "`getActiveForOrg()` (credential-free summary),
 * `insertActive()`, `deactivate()`, `openCredentialForOrg()` (composition-root
 * only). **No method returns the ciphertext in a summary**".
 *
 * `openCredentialForOrg` IS DELIBERATELY NOT ON THIS INTERFACE, and the reason
 * matters. §9's row reads "the bot token is returned by no repository method",
 * which taken literally forbids the very method §5 requires. The two are
 * reconciled the way `project-connections.repo.ts:8-12` already reconciles them
 * for PostHog: the SUMMARY methods carry no credential, and the credential
 * leaves through exactly ONE named, org-keyed, greppable door. Modelling that
 * door as a separate export rather than a member here is what lets the
 * enumeration row say something true about every method it names, and lets a
 * second row assert the door is singular and named.
 */
export interface SlackConnectionsRepo {
  /** FR-O9/FR-O10: ORG-scoped. Any member of the org gets the same answer, and
   *  a deactivated row is invisible to all of them. */
  getActiveForOrg(): Promise<SlackConnectionSummary | null>;
  /**
   * Relies on the partial unique index
   * `slack_connections_active_org_uidx` — `(organization_id) WHERE is_active`
   * — to refuse a second active connection. NO read-then-write (EC-O6, D6).
   */
  insertActive(input: InsertActiveSlackConnectionInput): Promise<SlackConnectionSummary>;
  /** FR-O9's org-wide revocation. `null` for another org's id — affected zero
   *  rows, never a silent success (D7). */
  deactivate(id: string): Promise<SlackConnectionSummary | null>;
}

export type CreateSlackConnectionsRepo = (db: ScopedDb, ctx: TenantContext) => SlackConnectionsRepo;

// ---------------------------------------------------------------------------
// AD-8 — `first_run_state` (org+project) and `first_run_dismissals` (org+user)
// ---------------------------------------------------------------------------

/**
 * The `first_run_state` row, at the (organization_id, project_id) grain.
 *
 * TWO NULLABLE STAMPS AND NOTHING ELSE. AD-8 gives the table `armed_at`,
 * `slack_skipped_at` and timestamps, and the absence of anything connection-
 * shaped here is load-bearing: FR-O14's degraded notice is derived from the
 * ABSENCE OF AN ACTIVE CONNECTION, not from `slack_skipped_at`, which is what
 * makes it survive a reload by construction. A `slackConnected` field on this
 * type would be the D11 hand-passed wire the split exists to avoid, and a §9
 * row asserts at runtime that no such key appears.
 */
export type FirstRunState = {
  /** The clock origin. Durable before the wait's first paint (storyboard T8),
   *  or the elapsed counter resets on reload. */
  readonly armedAt: Date | null;
  /** The STEP STATE's `skipped`, distinguishable from `pending`. Not the
   *  degraded notice — see the type's header. */
  readonly slackSkippedAt: Date | null;
};

/**
 * §5's Wave 2 table: "`readState()`, `arm()`, `skipSlack()`, `dismiss(userId)`,
 * `isDismissed(userId)`".
 *
 * UNDER-SPECIFIED, FLAGGED RATHER THAN GUESSED — two derivations, both stated:
 *
 *   (a) THE PROJECT ID. §5 writes the first three with empty parens, but the
 *       table's grain is `(organization_id, project_id)` (AD-8) and the org
 *       half comes from the context, so the project half has to arrive as a
 *       parameter. `readState(projectId)` mirrors
 *       `EventsCounterService.read(projectId)` exactly.
 *
 *   (b) THE STAMP. `arm` and `skipSlack` take the moment EXPLICITLY, the way
 *       every other write in this package does (`connectedAt`, `checkedAt`,
 *       `seenAt`, `tickAt`, `startedAt`). Two `arm()` calls that each read
 *       their own `Date.now()` can land in the same millisecond, which would
 *       make "re-arming replaces the origin" untestable without sleeping — and
 *       a test that sleeps to observe a clock is a test that flakes.
 *
 * `dismiss(userId)` keeps the ADD's own explicit user id rather than reading
 * `ctx.userId`, so the (organization_id, user_id) grain is visible at the call
 * site. That is not redundancy: it is the difference between a per-user fact
 * and a per-actor side effect, and AD-17 rests on it.
 */
export interface FirstRunRepo {
  /** `null` when the org+project pair has no row yet. NOT an empty state
   *  object — never armed and armed-then-cleared are different facts. */
  readState(projectId: string): Promise<FirstRunState | null>;
  /** "Watch again" RESETS the clock origin: one row per org+project, replaced,
   *  never appended to. */
  arm(projectId: string, armedAt: Date): Promise<FirstRunState>;
  skipSlack(projectId: string, skippedAt: Date): Promise<FirstRunState>;
  /** PER USER (AD-17). One member dismissing leaves every teammate
   *  undismissed — the property ESC-O2 rests on. */
  dismiss(userId: string, dismissedAt: Date): Promise<void>;
  isDismissed(userId: string): Promise<boolean>;
}

export type CreateFirstRunRepo = (db: ScopedDb, ctx: TenantContext) => FirstRunRepo;

// ---------------------------------------------------------------------------
// AD-6 — the status service
// ---------------------------------------------------------------------------

/**
 * §5's Wave 2 table: "The one read that assembles `StagePersistedFacts` from
 * the three tables (AD-6). Hand-written aggregation: names `ctx.organizationId`
 * itself, on both sides of every join".
 *
 * `read(projectId)` mirrors `EventsCounterService.read(projectId)`
 * (`packages/db/src/services/events-counter.service.ts:50`), the package's only
 * other hand-written aggregation service and the file AD-6's §9 row cites as
 * the discipline to copy.
 *
 * THE RETURN TYPE IS THE SHARED MIRROR'S, IMPORTED. See this file's header.
 */
export interface FirstRunStatusService {
  read(projectId: string): Promise<StagePersistedFacts>;
}

export type CreateFirstRunStatusService = (
  db: ScopedDb,
  ctx: TenantContext,
) => FirstRunStatusService;

// ---------------------------------------------------------------------------
// Shared test plumbing
// ---------------------------------------------------------------------------

/**
 * Minimal structural view of the two drivers' `execute`, copied verbatim from
 * `packages/db/src/repositories/analysis-runs.repo.ts:281-286` rather than
 * re-derived — `ScopedDb` is a union whose two members parameterize `execute`
 * on different query-result HKTs, so it is not callable through the union.
 *
 * WHY WAVE 0d NEEDS RAW SQL AT ALL, and why that is not a shortcut: three of
 * the columns these suites assert about are, by design, unreachable through any
 * typed path on this tree. `projects.provisioning_key` is added by Wave 2's
 * schema edit, so `db.select()` cannot name it. `credential_ciphertext` and
 * `credential_key_id` are unreachable ON PURPOSE and FOREVER — the whole point
 * of AD-20 is that no repository method returns them, so a test that could read
 * them through the repository would be testing a leak. Raw SQL is the only
 * honest way to assert what was actually persisted.
 */
export type RawExecutor = {
  execute(query: RawQuery): Promise<{ rows: unknown[] }>;
};

/** What the `sql` tagged template produces. `ReturnType<typeof sql>` in the
 *  cited file resolves to exactly this. */
type RawQuery = SQL;

/**
 * Reads one scalar column of one row through raw SQL, as `unknown`.
 *
 * Returns `undefined` when no row matched, so "no such row" and "the column is
 * NULL" stay distinguishable — a distinction two of these suites assert on
 * directly (a NULL `provisioning_key` is a project some other path created; a
 * missing row is a project that was never provisioned).
 */
export async function readRawScalar(db: ScopedDb, query: RawQuery): Promise<unknown> {
  const { rows } = await (db as unknown as RawExecutor).execute(query);
  const [row] = rows;
  if (row === undefined) return undefined;
  const values = Object.values(row as Record<string, unknown>);
  return values[0];
}

/** Every raw row a query returned, as plain records. */
export async function readRawRows(
  db: ScopedDb,
  query: RawQuery,
): Promise<Record<string, unknown>[]> {
  const { rows } = await (db as unknown as RawExecutor).execute(query);
  return rows as Record<string, unknown>[];
}

/**
 * The Postgres failure fields, dug out of whichever wrapper threw.
 *
 * A refusal SETTLED BY A CONSTRAINT carries `code === "23505"` and the index's
 * own name. A refusal settled by A PRIOR READ carries neither — it is an
 * ordinary application error with a nice message. That difference is the entire
 * assertion behind EC-O6's "by constraint, never by a prior read", and it is
 * why these suites never assert on a row count there: a racy read-then-insert
 * produces the same row count on a single-connection driver.
 *
 * Walks `error`, `error.cause`, and `error.cause.cause` because the three
 * shapes this repository already produces disagree: `ensure-organization.ts:39`
 * reads `error.cause.code`, `project-connections.repo.ts:137` reads the same
 * place but re-throws a `ConnectionWriteError` carrying `code`/`constraint` at
 * the top level, and a repository that simply lets drizzle's error escape puts
 * them one level deeper again. Accepting all three means this helper asserts
 * the DATABASE's answer rather than a particular wrapper's shape.
 */
export interface PgFailure {
  readonly code: string | null;
  readonly constraint: string | null;
  readonly message: string;
}

export function readPgFailure(error: unknown): PgFailure {
  const candidates: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current != null; depth += 1) {
    candidates.push(current);
    current = (current as { cause?: unknown }).cause;
  }

  let code: string | null = null;
  let constraint: string | null = null;

  for (const candidate of candidates) {
    const fields = candidate as { code?: unknown; constraint?: unknown };
    if (code === null && typeof fields.code === "string") code = fields.code;
    if (constraint === null && typeof fields.constraint === "string") {
      constraint = fields.constraint;
    }
  }

  return {
    code,
    constraint,
    message: candidates
      .map((candidate) => (candidate instanceof Error ? candidate.message : String(candidate)))
      .join(" | "),
  };
}

/**
 * Runs `work` and returns whatever it threw. Fails the calling row if it did
 * not throw at all, so "the constraint refused it" can never pass by the write
 * quietly succeeding.
 */
export async function captureRejection(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("expected the write to be refused, but it succeeded");
}
