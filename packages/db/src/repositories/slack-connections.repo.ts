// Repository for the `slack_connections` table (O-008 AD-8, AD-20, FR-O9/
// FR-O10/FR-O13). The factory takes a `TenantContext` at construction — the
// only way to name an organization — and no method below accepts an
// organization id as a parameter. Every read filters on `ctx.organizationId`;
// every mutation is keyed on `(ctx.organizationId, id)` with `.returning()`, so
// a foreign-org id affects zero rows and returns `null` rather than silently
// succeeding.
//
// ── ORG-SCOPED, NOT ACTOR-SCOPED (D1, D2) ───────────────────────────────────
// The connection belongs to the ORGANIZATION. A teammate who set nothing up
// reads the same row the owner connected, and a revocation by any member takes
// it away from all of them. `connected_by_user_id` is ATTRIBUTION — it exists
// so a test post can name who connected it (OQ-O6) — and no read here may ever
// narrow by it. A read keyed on the acting user is the D1 flagship bug: it
// works for the person who set it up and shows every teammate an unconnected
// organization, silently.
//
// ── THE BOT TOKEN LEAVES BY EXACTLY ONE DOOR, AND IT IS NAMED ───────────────
// `getActiveForOrg` / `insertActive` / `attachChannel` / `deactivate` all
// return `SlackConnectionSummary`, built field-by-field by
// `toSlackConnectionSummary` below — NEVER a spread of the row — so
// `credential_ciphertext` and `credential_key_id` cannot ride out by accident.
// The one function that opens the credential is `openCredentialForOrg`, it is
// org-keyed by construction, and it is greppable by design: the same discipline
// `project-connections.repo.ts:8-12` states for the PostHog credential, and the
// same reason `readConnectionCredential` is blunt about its own name.
//
// **`openCredentialForOrg` IS FOR THE DELIVERY COMPOSITION ROOT AND NOTHING
// ELSE** (ADD §5). No route, no page, and no service may call it: a request
// path has no reason to hold a decrypted bot token, and every call site is one
// grep away from review.
//
// ── THE AAD HAS ONE PRODUCER ────────────────────────────────────────────────
// Both the seal and the open are bound under `slackCredentialAad(ctx)`
// (`../schema/slack-connections.ts`), which takes a `TenantContext` and no
// project id — deliberately, because an envelope sealed under
// `credentialAad(orgId, projectId)` writes perfectly and fails at DELIVERY
// time, per customer, silently. This file never calls `credentialAad` itself.
import type { CredentialKey, DecryptResult, TenantContext } from "@growthmind/shared";
import { decryptSecret } from "@growthmind/shared";
import { and, eq, isNull } from "drizzle-orm";

import { slackConnections, slackCredentialAad } from "../schema/slack-connections";
import type { ScopedDb } from "./types";

/** The raw persisted row — INCLUDES the ciphertext, unlike
 * `SlackConnectionSummary`. Never return this type from a repository method. */
export type SlackConnectionRow = typeof slackConnections.$inferSelect;

/**
 * What a `slack_connections` read hands back: everything a caller needs to
 * render or address the organization's delivery channel, and NEITHER
 * credential column.
 *
 * The omission is the contract, and it is enforced at the mapper below rather
 * than by this type alone — a structural type cannot refuse an extra property
 * a spread of the row would actually carry.
 */
export interface SlackConnectionSummary {
  readonly id: string;
  /** Stamped directly on the row, per the `project_connections` denormalization
   * discipline. The column every read filters on (D2). */
  readonly organizationId: string;
  /**
   * FR-O13: the delivery address, read by the lane source off THIS ROW and
   * never accepted from a payload.
   *
   * `null` MEANS "A WORKSPACE IS ATTACHED AND NOTHING CAN BE DELIVERED" (AD-4)
   * — not "no Slack", which is this whole summary being `null`. The two are
   * different answers with different next actions, and the type is widened here
   * rather than left `string` because a consumer that still believes this
   * cannot be null compiles happily against a lie and hands `null` to a poster
   * that interpolates it into the four characters `null`. Every consumer that
   * needs a postable address goes through `isDeliveryTarget`, whose predicate
   * form means no call site needs a `!`.
   */
  readonly channelId: string | null;
  /**
   * Slack's own name for the workspace, for "Connected to {workspace}.".
   *
   * NOT A CREDENTIAL — it is visible to everyone in the workspace, so unlike
   * `credential_ciphertext` it may ride out in a summary. `null` on the
   * pasted-token path, which is never told one; the sentence is then simply not
   * rendered rather than rendered around an empty hole.
   */
  readonly workspaceName: string | null;
  readonly isActive: boolean;
  /** ATTRIBUTION ONLY — never a filter. `null` once that user row is deleted. */
  readonly connectedByUserId: string | null;
  readonly connectedAt: Date;
}

/**
 * AD-20's write input. THE ENVELOPE ARRIVES ALREADY SEALED, exactly as it does
 * for `project_connections`: the caller resolves the key through
 * `resolveCredentialKey(env)` — the insecure-defaults gate is INHERITED here,
 * never re-implemented — encrypts under `slackCredentialAad(ctx)`, and this
 * layer persists what it was handed, byte for byte.
 *
 * There is deliberately NO `health` field. The column defaults to `validating`,
 * which is the honest value at insert: pasting a bot token proves nothing about
 * it. The test post is the separate, deliberate step that moves it.
 */
export interface InsertActiveSlackConnectionInput {
  /**
   * `null` ON THE OAUTH PATH, and that is the state AD-4 exists to make
   * writable: the callback holds a real bot token and does not yet know which
   * channel the founder wants. The pasted-token path supplies both at once and
   * passes a string. `attachChannel` is what fills the null in later.
   */
  readonly channelId: string | null;
  /**
   * Slack's `team.name` from the OAuth exchange. Absent or `null` from the
   * pasted-token path, which is handed a token and a channel and is never told
   * a workspace name.
   *
   * OPTIONAL, AND THE OPTIONALITY IS A KNOWN D11 EXPOSURE RATHER THAN A
   * PREFERENCE. Required would be the stronger contract — a value one surface
   * computes and another must store is precisely the wire that goes
   * un-connected in silence, and here the only symptom of forgetting it is a
   * sentence that never renders. It is optional because the shipped
   * `insertActive` callers predate this field and one of them is a test
   * contract this change is required to satisfy without editing. The exposure
   * is closed by a test on the OAuth callback asserting the name is PERSISTED,
   * not by this signature; a callback that reads `team.name` and drops it
   * type-checks.
   */
  readonly workspaceName?: string | null;
  /** The `v1.<keyId>.<iv>.<tag>.<ciphertext>` envelope. */
  readonly credentialCiphertext: string;
  /** `keyIdOf(key)` — the 8-hex fingerprint, never the key (D12). */
  readonly credentialKeyId: string;
  readonly connectedByUserId: string;
  readonly connectedAt: Date;
}

export interface SlackConnectionsRepo {
  /** FR-O9/FR-O10: ORG-scoped. Any member gets the same answer, and a
   * deactivated row is invisible to all of them. */
  getActiveForOrg(): Promise<SlackConnectionSummary | null>;
  /**
   * Relies on the partial unique index `slack_connections_active_org_uidx`
   * — `(organization_id) WHERE is_active` — to refuse a second active
   * connection. NO read-then-write (EC-O6, D6): two members connecting at the
   * same moment cannot both win, and the loser learns it from Postgres.
   */
  insertActive(input: InsertActiveSlackConnectionInput): Promise<SlackConnectionSummary>;
  /**
   * The second half of the OAuth flow: the channel the founder picked, stamped
   * onto the organization's own active row (AD-4).
   *
   * TAKES A CHANNEL AND NO CONNECTION ID, and that is the D7 property rather
   * than a convenience. The channel id arrives on a request body; the ROW is
   * chosen by this repository's own `(organization_id, is_active)` filter, so
   * there is no parameter through which one organization could name another's
   * connection. It is the same reasoning `deactivate` states for keying on
   * `(organization_id, id)`, taken one step further — here there is no id at
   * all.
   *
   * ONE `UPDATE … RETURNING`, never a read-then-write (D6): two members
   * finishing the picker at the same moment produce a last-writer-wins channel
   * rather than a lost update over a row one of them had already read.
   *
   * `channelId` is `string`, NOT `string | null`. Attaching is choosing an
   * address; there is no "detach" and this method must never be the route
   * through which a null is laundered back onto a connected row.
   *
   * ONCE-ONLY: the statement also filters on `channel_id IS NULL`, so it fills
   * an empty address and never MOVES a chosen one. See the statement below for
   * why re-pointing is a feature with a migration rather than a side effect of
   * a picker.
   *
   * `null` means NOTHING WAS UPDATED, and there are now two ways that happens:
   * the organization has no active connection, or its active connection already
   * has a channel. The repository does not tell them apart — it reports that it
   * wrote nothing, and the caller that has the organization's state in hand
   * (`getActiveForOrg`) is the one that can say which, in a sentence a person
   * reads.
   */
  attachChannel(channelId: string): Promise<SlackConnectionSummary | null>;
  /**
   * FR-O9's ORG-WIDE revocation. Never a DELETE — the row survives so history
   * outlives a reconnect and "an installation whose only connection is
   * deactivated" stays distinguishable from one that never connected.
   * `null` for another org's id: affected zero rows, never a silent success.
   */
  deactivate(id: string): Promise<SlackConnectionSummary | null>;
  /**
   * THE ONE DOOR TO THE BOT TOKEN, and it is for the DELIVERY COMPOSITION ROOT
   * ONLY (ADD §5). Org-keyed by construction — the organization can only come
   * from the context this repository was built with, so there is no id-only
   * route to key material anywhere in this package.
   *
   * `null` means the organization has no active connection — a supported state,
   * not a fault. A `DecryptResult` with `ok: false` is a NAMED failure and
   * never a throw escaping into a delivery loop (F-11 fails closed).
   */
  openCredentialForOrg(key: CredentialKey): Promise<DecryptResult | null>;
}

/**
 * A write refused by the database, re-thrown WITHOUT the driver's parameter
 * echo.
 *
 * WHY THIS EXISTS AT ALL (FR-7, and a real incident one table over): drizzle's
 * own `DrizzleQueryError.message` is literally `Failed query: … params: <every
 * bound value>`, and for this table one of those bound values is the AES
 * envelope holding a customer's Slack bot token. Re-throwing the raw error
 * would put that envelope into every log, breadcrumb and error report that
 * catches it. So: surface the DRIVER's own message (constraint names, never
 * parameter values), scrub the two values we know we just wrote as a second
 * pass, and deliberately attach NO `cause` — a cause chain prints the parameter
 * echo again the moment anyone logs the error object.
 *
 * `code` and `constraint` are carried at the top level because that is what a
 * caller branches on: the INDEX NAME, never a parsed message.
 *
 * NOT SHARED WITH `project-connections.repo.ts`'s identical helper, and that is
 * a deliberate deferral rather than an oversight: extracting one copy would
 * edit that repository, which this sprint's wave does not own. Whoever next
 * touches both files should lift this into one home.
 */
export class SlackConnectionWriteError extends Error {
  readonly code: string | null;
  readonly constraint: string | null;

  constructor(message: string, code: string | null, constraint: string | null) {
    super(message);
    this.name = "SlackConnectionWriteError";
    this.code = code;
    this.constraint = constraint;
  }
}

interface DriverErrorFields {
  message?: unknown;
  code?: unknown;
  constraint?: unknown;
}

/** drizzle wraps the driver error as `cause` and puts the SQL + BOUND
 * PARAMETERS in its own `message`. The driver error underneath carries the
 * constraint name and no parameter values, so that is the one we surface. */
function readDriverFields(error: unknown): DriverErrorFields {
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  const candidate = (cause ?? error) as DriverErrorFields | null | undefined;
  return candidate ?? {};
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function rethrowWithoutParameters(error: unknown, secrets: readonly string[]): never {
  const fields = readDriverFields(error);
  const driverMessage =
    asStringOrNull(fields.message) ??
    (error instanceof Error ? error.message : String(error)) ??
    "database write refused";

  let scrubbed = driverMessage;
  for (const secret of secrets) {
    if (secret.length > 0) {
      scrubbed = scrubbed.split(secret).join("[redacted]");
    }
  }

  throw new SlackConnectionWriteError(
    scrubbed,
    asStringOrNull(fields.code),
    asStringOrNull(fields.constraint),
  );
}

/**
 * Maps a persisted row to the DTO boundary as an explicit field-by-field pick,
 * never a spread and never a cast, so `credential_ciphertext` and
 * `credential_key_id` cannot leak through by accident. This function is the
 * enforcement point for AD-20's "no method returns the ciphertext in a summary".
 */
export function toSlackConnectionSummary(row: SlackConnectionRow): SlackConnectionSummary {
  return {
    id: row.id,
    organizationId: row.organizationId,
    channelId: row.channelId,
    workspaceName: row.workspaceName,
    isActive: row.isActive,
    connectedByUserId: row.connectedByUserId,
    connectedAt: row.connectedAt,
  };
}

export function createSlackConnectionsRepo(db: ScopedDb, ctx: TenantContext): SlackConnectionsRepo {
  return {
    async getActiveForOrg(): Promise<SlackConnectionSummary | null> {
      const [row] = await db
        .select()
        .from(slackConnections)
        .where(
          and(
            eq(slackConnections.organizationId, ctx.organizationId),
            eq(slackConnections.isActive, true),
          ),
        )
        .limit(1);

      return row ? toSlackConnectionSummary(row) : null;
    },

    async insertActive(input: InsertActiveSlackConnectionInput): Promise<SlackConnectionSummary> {
      try {
        // NO `health` — the column's own default (`validating`) is the honest
        // value, and supplying one here would have this row assert something no
        // code has checked. NO prior read either: the partial unique index is
        // what refuses a second active connection (EC-O6, D6).
        const [row] = await db
          .insert(slackConnections)
          .values({
            organizationId: ctx.organizationId,
            channelId: input.channelId,
            // `?? null` rather than letting the key go missing: an absent key
            // and an explicit null must land on the column as the same value,
            // or "we were never told" and "there is no name" would be two
            // different persisted states of one fact.
            workspaceName: input.workspaceName ?? null,
            credentialCiphertext: input.credentialCiphertext,
            credentialKeyId: input.credentialKeyId,
            isActive: true,
            connectedByUserId: input.connectedByUserId,
            connectedAt: input.connectedAt,
          })
          .returning();

        if (!row) {
          throw new SlackConnectionWriteError("insertActive: insert returned no row", null, null);
        }

        return toSlackConnectionSummary(row);
      } catch (error) {
        if (error instanceof SlackConnectionWriteError) {
          throw error;
        }
        rethrowWithoutParameters(error, [input.credentialCiphertext, input.credentialKeyId]);
      }
    },

    async attachChannel(channelId: string): Promise<SlackConnectionSummary | null> {
      // THE ROW IS FOUND BY THIS CONTEXT, NEVER BY ANYTHING ON THE REQUEST
      // (D7). The only identifying values in this statement are
      // `ctx.organizationId` and `is_active`; the channel id — the one value
      // that did arrive from a payload — appears solely in the SET clause. An
      // organization therefore cannot address another's connection, because
      // there is no parameter through which it could name one.
      //
      // A SINGLE `UPDATE … RETURNING`, not a read-then-write (D6). The
      // half-connected row is the org's one active row by the partial unique
      // index, so this matches at most one, and two members finishing the
      // picker together settle it in Postgres rather than by racing a prior
      // read.
      //
      // NO `health` CHANGE HERE. Choosing an address proves nothing about
      // delivery, exactly as pasting a token proves nothing about the token —
      // the test post is the separate, deliberate step that moves that column,
      // and a failed test post must not undo a correct pick (D8).
      //
      // `channel_id IS NULL` IS THE HALF THAT MAKES THIS A FILL RATHER THAN A
      // RE-POINT, AND DELETING IT REPLAYS THE CUSTOMER'S WHOLE BACKLOG.
      //
      // The delivery ledger's identity is the tuple `(organization_id,
      // finding_id, channel_id)` — `deliveries.repo.ts` conflicts `claimForPost`
      // on exactly it, and `../schema/deliveries.ts` is where the unique index
      // `deliveries_org_finding_channel_key` says so. THE CHANNEL IS AN INPUT TO
      // THAT IDENTITY, so moving it forks every delivery this organization has
      // ever recorded (D12): `findFor` answers `null` for the entire history,
      // every finding already sent reads as never sent, and the weekly delivery
      // budget starts from zero. Nothing errors. The customer simply receives
      // their whole backlog again, in a channel one member chose, and the guard
      // that limits how much we post is gone for that week.
      //
      // Without this predicate the write is unprotected in a way its neighbour
      // is not: `insertActive` is refused by the partial unique index
      // `slack_connections_active_org_uidx`, and there is no index that can
      // refuse an UPDATE of a column to a different value. The database cannot
      // hold this line; this clause is the only thing that does.
      //
      // SO RE-POINTING IS NOT SHIPPED, deliberately, and this is not the place
      // to add it. It is a real thing a founder will eventually want, and it
      // needs a story for the `deliveries` rows that already exist — migrate
      // them onto the new address, or suppress them — which is a feature with a
      // migration and a decision, not a side effect of a picker. Whoever comes
      // to delete this line to "let people change the channel" is looking at the
      // silent-replay bug from the inside.
      const [row] = await db
        .update(slackConnections)
        .set({ channelId })
        .where(
          and(
            eq(slackConnections.organizationId, ctx.organizationId),
            eq(slackConnections.isActive, true),
            isNull(slackConnections.channelId),
          ),
        )
        .returning();

      return row ? toSlackConnectionSummary(row) : null;
    },

    async deactivate(id: string): Promise<SlackConnectionSummary | null> {
      // AN UPDATE, NEVER A DELETE, and keyed on `(organization_id, id)` rather
      // than the id alone (D7): org B naming org A's connection id affects zero
      // rows and gets `null`, instead of silently revoking another customer's
      // delivery.
      const [row] = await db
        .update(slackConnections)
        .set({ isActive: false, health: "disconnected" })
        .where(
          and(eq(slackConnections.organizationId, ctx.organizationId), eq(slackConnections.id, id)),
        )
        .returning();

      return row ? toSlackConnectionSummary(row) : null;
    },

    async openCredentialForOrg(key: CredentialKey): Promise<DecryptResult | null> {
      const [row] = await db
        .select({
          ciphertext: slackConnections.credentialCiphertext,
          keyId: slackConnections.credentialKeyId,
        })
        .from(slackConnections)
        .where(
          and(
            eq(slackConnections.organizationId, ctx.organizationId),
            eq(slackConnections.isActive, true),
          ),
        )
        .limit(1);

      if (!row) {
        return null;
      }

      // The AAD comes from `slackCredentialAad(ctx)` and from nowhere else, so
      // the ciphertext's binding and the row's `organization_id` filter are
      // physically incapable of disagreeing. A ciphertext lifted from another
      // organization's row fails authentication here rather than decrypting.
      //
      // `row.keyId` is deliberately NOT compared against `keyIdOf(key)` in this
      // file: `decryptSecret` already does exactly that, and reports a
      // `key_id_mismatch` a caller can tell apart from an authentication
      // failure. A second copy of that check is a second place for the two to
      // disagree.
      return decryptSecret(row.ciphertext, key, slackCredentialAad(ctx));
    },
  };
}
