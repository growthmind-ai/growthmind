// Wave 0 mirror of O-008's persistence contract — the `packages/db` sibling of
// `packages/shared/__tests__/onboarding/contract-shapes.ts`, which it imports for
// `StagePersistedFacts` rather than re-declaring it (`shared` may not import `db`). The
// loaders cast to these types, so Wave 2 signature drift fails at runtime, not here.
import type { TenantContext } from "@growthmind/shared";
import type { SQL } from "drizzle-orm";

import type { StagePersistedFacts } from "../../../shared/__tests__/onboarding/contract-shapes";
import type { ScopedDb } from "../../src/repositories/types";

export type { StagePersistedFacts };

export function provisioningKeyFor(organizationId: string): string {
  return `org:${organizationId}`;
}

export type EnsureProjectResult = { readonly projectId: string };

export type EnsureProject = (db: ScopedDb, ctx: TenantContext) => Promise<EnsureProjectResult>;

export type SlackConnectionSummary = {
  readonly id: string;

  readonly organizationId: string;

  // `null` since AD-4: a workspace is attached and nothing can be delivered.
  readonly channelId: string | null;
  readonly channelName: string | null;
  readonly workspaceName: string | null;

  readonly isActive: boolean;

  readonly connectedByUserId: string | null;
  readonly connectedAt: Date;
};

export interface InsertActiveSlackConnectionInput {
  // `null` on the OAuth path, which holds a token before it knows the channel (AD-4).
  readonly channelId: string | null;
  readonly workspaceName?: string | null;

  readonly credentialCiphertext: string;

  readonly credentialKeyId: string;
  readonly connectedByUserId: string;
  readonly connectedAt: Date;
}

export interface SlackConnectionsRepo {
  getActiveForOrg(): Promise<SlackConnectionSummary | null>;

  insertActive(input: InsertActiveSlackConnectionInput): Promise<SlackConnectionSummary>;

  // Takes a channel and no connection id: the row is chosen by the repository's own filter,
  // so a payload cannot name another org's connection (D7).
  attachChannel(
    channelId: string,
    channelName: string | null,
  ): Promise<SlackConnectionSummary | null>;

  deactivate(id: string): Promise<SlackConnectionSummary | null>;
}

export type CreateSlackConnectionsRepo = (db: ScopedDb, ctx: TenantContext) => SlackConnectionsRepo;

export type FirstRunState = {
  readonly armedAt: Date | null;

  readonly slackSkippedAt: Date | null;
};

export interface FirstRunRepo {
  readState(projectId: string): Promise<FirstRunState | null>;

  arm(projectId: string, armedAt: Date): Promise<FirstRunState>;
  skipSlack(projectId: string, skippedAt: Date): Promise<FirstRunState>;

  dismiss(userId: string, dismissedAt: Date): Promise<void>;
  isDismissed(userId: string): Promise<boolean>;
}

export type CreateFirstRunRepo = (db: ScopedDb, ctx: TenantContext) => FirstRunRepo;

export interface FirstRunStatusService {
  read(projectId: string): Promise<StagePersistedFacts>;
}

export type CreateFirstRunStatusService = (
  db: ScopedDb,
  ctx: TenantContext,
) => FirstRunStatusService;

export type RawExecutor = {
  execute(query: RawQuery): Promise<{ rows: unknown[] }>;
};

type RawQuery = SQL;

export async function readRawScalar(db: ScopedDb, query: RawQuery): Promise<unknown> {
  const { rows } = await (db as unknown as RawExecutor).execute(query);
  const [row] = rows;
  if (row === undefined) return undefined;
  const values = Object.values(row as Record<string, unknown>);
  return values[0];
}

export async function readRawRows(
  db: ScopedDb,
  query: RawQuery,
): Promise<Record<string, unknown>[]> {
  const { rows } = await (db as unknown as RawExecutor).execute(query);
  return rows as Record<string, unknown>[];
}

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

export async function captureRejection(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work();
  } catch (error) {
    return error;
  }
  throw new Error("expected the write to be refused, but it succeeded");
}
