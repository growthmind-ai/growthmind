// The "./admin" subpath's entire surface: one function and its three types,
// and nothing else (O-009, ADD D-9).
//
// WHY THIS IS ONE FILE AND NOT A BARREL PLUS A MODULE. The gate in
// `__tests__/admin/reachability.test.ts` flags any specifier that RESOLVES into
// this directory — including a relative one written from inside
// `packages/db/src`, which is exactly the barrel re-export that would undo the
// boundary. A conventional `index.ts` re-exporting `./organizations` is that
// same shape and the gate does not (and should not) special-case its own
// directory. So the subpath's surface is literally one file: nothing imports
// this module, and this module imports nothing from itself. Split it in two and
// the gate goes red — correctly.
//
// REACHABLE ONLY FROM `scripts/`. Deliberately NOT re-exported from
// `src/index.ts` — the subpath boundary is what makes a violating import a
// single greppable line, and the reachability suite turns that convention into
// a gate: no file under `apps/`, `worker/` or `packages/*/src` imports this
// module, and the main barrel exports nothing from it. This is the same
// mechanism `src/system/index.ts` documents, with one deliberate difference —
// the system version forbids every caller, this one allows `scripts/`, because
// a person at a terminal is the only actor that legitimately has no session to
// derive scope from.
//
// WHY THIS DIRECTORY IS NOT IN `__tests__/repositories/no-org-param.test.ts`'s
// `SCANNED_DIRS`, and must not be added to it. That scan forbids any repository
// or service method from accepting an organisation identifier as a parameter,
// because everywhere a request context exists, scope must come from the context
// and never from the caller — a client-supplied org id flowing into a query is
// the cross-tenant read the whole tenancy design exists to prevent.
// `resolveOrganizationForCli` DOES take an organisation identifier, and that is
// correct here for exactly the reason the scan exists: admin code runs without
// a user context BY DESIGN, so an explicit operator argument is the only
// possible source of scope. Widening the scan to cover this directory would
// make it fail, and the "fix" a future agent would reach for — deleting the
// parameter — would delete the operator's only way to name an organisation.
// The reachability gate is this module's containment; the org-param scan is
// not, and was never meant to be.
//
// WHY THE QUERY BELOW IS UNSCOPED. A CLI has no session. Before an operator can
// mint a read credential for an organisation, something has to answer "which
// organisation?" — and that question cannot be asked from inside a scope that
// does not exist yet. So this function reads every organisation row, which is
// precisely the shape every other query in this package is forbidden to take.
//
// WHAT IT NEVER DOES: it never creates an organisation, never falls back to
// "the first one", and never resolves an organisation without a real owner. A
// CLI that invents its own tenant is a CLI that mints a credential nobody
// asked for.
import { asc, eq } from "drizzle-orm";

import type { ScopedDb } from "../repositories/types";
import { member, organization, user } from "../schema/auth";

/** A fully resolved organisation: the org AND the person the CLI will act as.
 * The owner comes back HERE, in the same call, so `no_owner` is a resolution
 * failure the caller cannot forget to check (ADD D-9). */
export interface AdminOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly ownerUserId: string;
  readonly ownerEmail: string;
}

/** One line of the "here is what exists, pick one" list a refusal prints.
 * `ownerEmail` is nullable because an owner-less organisation is still a
 * candidate worth naming — the operator needs to see it to understand why the
 * command refused. */
export interface AdminOrganizationCandidate {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly ownerEmail: string | null;
}

export type ResolveOrganizationResult =
  | { readonly ok: true; readonly organization: AdminOrganization }
  | {
      readonly ok: false;
      readonly reason: "none_exist" | "ambiguous" | "not_found" | "no_owner";
      readonly candidates: readonly AdminOrganizationCandidate[];
    };

interface OrganizationOwner {
  readonly userId: string;
  readonly email: string;
}

/**
 * Resolves the organisation a CLI invocation acts on, together with its owner.
 *
 * The rules, each of which has its own named row in
 * `packages/db/__tests__/admin/resolve-organization.test.ts`:
 *
 * - **A count of one is not a pick** (OQ-2). With exactly one organisation
 *   there is no choice to make and no ordering is consulted — it is the only
 *   possible answer, and it is what makes minting a genuine one-command flow.
 *   Two or more refuses with `ambiguous` and names every candidate, so the
 *   operator can pass `--org <id>` without going to the database themselves.
 * - **`--org` is exact id first, exact slug second** (OQ-1), and nothing else.
 *   No prefix match, no case folding, no ordering tiebreak — a deterministic
 *   miss is a refusal, never a hint. An explicit `--org` that misses NEVER
 *   falls back to "the only one".
 * - **An owner-less organisation refuses** (`no_owner`) rather than resolving
 *   without one. The caller builds a real owner `TenantContext` from what this
 *   returns; with no owner there is nothing truthful to build it from, and a
 *   CLI must never invent an actor.
 * - **Nothing is ever created.** An empty database refuses with `none_exist`.
 */
export async function resolveOrganizationForCli(
  db: ScopedDb,
  input: { readonly org?: string },
): Promise<ResolveOrganizationResult> {
  // Deterministic order so a refusal prints the same candidate list twice in a
  // row. It is presentation order only — it is never consulted to break a tie,
  // because there is no tie this function is willing to break.
  const organizations = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .orderBy(asc(organization.createdAt), asc(organization.id));

  const ownerByOrganization = await readOwners(db);

  const candidates: AdminOrganizationCandidate[] = organizations.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerEmail: ownerByOrganization.get(row.id)?.email ?? null,
  }));

  const [only] = candidates;
  if (only === undefined) {
    // Checked before `--org` on purpose: with an empty table the truthful and
    // actionable answer is "sign up first", not "that one does not exist".
    return { ok: false, reason: "none_exist", candidates: [] };
  }

  let target: AdminOrganizationCandidate;

  if (input.org !== undefined && input.org.length > 0) {
    const named = input.org;
    const byId = candidates.find((candidate) => candidate.id === named);
    const matched = byId ?? candidates.find((candidate) => candidate.slug === named);
    if (matched === undefined) {
      return { ok: false, reason: "not_found", candidates };
    }
    target = matched;
  } else {
    if (candidates.length > 1) {
      return { ok: false, reason: "ambiguous", candidates };
    }
    target = only;
  }

  const owner = ownerByOrganization.get(target.id);
  if (owner === undefined) {
    return { ok: false, reason: "no_owner", candidates };
  }

  return {
    ok: true,
    organization: {
      id: target.id,
      name: target.name,
      slug: target.slug,
      ownerUserId: owner.userId,
      ownerEmail: owner.email,
    },
  };
}

/**
 * Every organisation's owner, in one query.
 *
 * Semantically identical to `OrganizationsRepo.creatorEmail()`
 * (`../repositories/organizations.repo.ts`) — `member ⋈ user`, `role = "owner"`,
 * earliest `member.createdAt` wins — computed for every organisation in a
 * single pass instead of one organisation at a time, because a refusal has to
 * name every candidate and an N+1 over the org list just to print a list is not
 * worth writing. `member.id` breaks a `createdAt` tie so the answer does not
 * depend on row order.
 *
 * The inner join means a `member` row pointing at a deleted user drops out
 * rather than resolving to a partial owner, and an empty email is treated as no
 * owner at all — the same fail direction `creatorEmail()` documents: infer
 * NOTHING rather than act as somebody who is not there.
 */
async function readOwners(db: ScopedDb): Promise<Map<string, OrganizationOwner>> {
  const rows = await db
    .select({
      organizationId: member.organizationId,
      userId: user.id,
      email: user.email,
    })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.role, "owner"))
    .orderBy(asc(member.createdAt), asc(member.id));

  const owners = new Map<string, OrganizationOwner>();
  for (const row of rows) {
    if (row.email.length === 0 || owners.has(row.organizationId)) {
      continue;
    }
    owners.set(row.organizationId, { userId: row.userId, email: row.email });
  }
  return owners;
}
