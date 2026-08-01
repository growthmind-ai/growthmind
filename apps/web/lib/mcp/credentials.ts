// Who is allowed to read this surface, and with what.
//
// The decision: An MCP read uses a different kind of credential from event ingest, and
// that credential is an `api_keys` row
//
// The question the route had to settle is whether a `write_keys` row. The credential
// `resolveWriteKeyForIngest` resolves. May authenticate a read of an organization's
// findings. It may not, and the reason is written into `docs/architecture.md` in the
// architecture's own words:
//
// > Each project issues **public write keys** … A public key is spoofable by
// > construction (the same accepted risk as every analytics SDK) so the
// > containment is structural: a key reaches exactly one project, is
// > rate-limited and rotatable, and anomalous key traffic quarantines rather
// > than ingests.
//
// Read that containment argument again with a read tool in the picture. It holds only
// because the capability a write key grants is "append activity to one project". The
// blast radius of a stolen write key is junk telemetry in one project, which quarantine
// handles. A write key that also granted `list_open_fixes` would have a blast radius of
// every finding in the organization. The growth problems, the counts, the evidence, the
// fix instructions. Handed to anyone who opened the customer's page source, because
// that key ships in the customer's browser. It is published, by design, on the public
// internet. There is no version of that trade that is acceptable, and no amount of rate
// limiting makes a published credential a read credential.
//
// Both kinds are equally disqualified, and for the same reason rather than by listing
// them: `writeKeyKindSchema` is `["standard", "simulation"]`
// (`packages/shared/src/write-keys/types.ts`) and the two differ only in the `origin`
// the server stamps on what they ingest. Neither means "a person deliberately handed
// this to an agent". Both are carried by a website's own code.
//
// That argument is why this file exists, and it does not expire now that the other
// family is built. It is the standing reason `api_keys` is a separate table. Listed
// beside `write_keys` in `docs/architecture.md` precisely because it is a separate
// thing, minted by a person and handed to one agent, never published anywhere.
//
// So what this file does: Resolves the read family, and fails closed
//
// `createApiKeyMcpCredentials` resolves a presented string through
// `resolveApiKeyForRead` (`packages/db/src/repositories/api-keys.repo.ts`): the format
// check first, then the hash lookup with the revocation filter in the same predicate,
// then an organization id or nothing. Unknown, malformed, revoked and wrong-family all
// come back `null`, and the caller turns every `null` into one frozen refusal.
//
// The refusal of an ingest key is now earlier and stricter than the kind gate it
// replaces. `gmak_` and `gmwk_` differ at index 2, so `isApiKeyFormat` refuses a
// genuine write key before any database access. A write key is not merely inadmissible
// here, it cannot even be looked up. The named tests in
// `apps/web/__tests__/mcp/credentials.test.ts` still mint genuine, unrevoked keys of
// every `WriteKeyKind` against a real database, assert the refusal is byte-identical to
// presenting no key at all, and separately assert the same keys DO resolve through
// `resolveWriteKeyForIngest`, so each refusal is demonstrably this gate rather than a
// broken fixture.
//
// No try/catch lives in this file, and that is a requirement. `./server.ts`'s
// `authenticate` already wraps `resolve`, logs the failure and refuses. A second
// catch here would swallow the error before the one place that logs it, making an
// unreachable credential store indistinguishable from a clean miss in the log.
//
// No cache lives in this file either, and that is also a requirement. The store is
// reached on every well-formed presentation: one lookup on a unique index, and it is
// what makes revocation live on the very next request. A process-level memo would break
// revocation silently. The named test `refuses a credential revoked between two
// requests` is what fails if anyone adds one.
import { resolveApiKeyForRead, type ScopedDb } from "@growthmind/db";

/**
 * What authentication produces, and the only thing it produces.
 *
 * One field, on purpose. Every read below it is scoped by this organization id and by
 * nothing else the caller said, so there is no second field a handler could
 * accidentally prefer over it. The project id the presented credential may also carry
 * is deliberately not here: `list_open_fixes` takes an optional `projectId` argument,
 * and a credential-borne project would silently either override or contradict it.
 * (`api_keys` carries no project at all, for exactly this reason. See that table's
 * schema header.)
 */
export interface McpCredential {
  readonly organizationId: string;
}

/**
 * Turning a presented string into an organization, or into nothing.
 *
 * A port, for the same reason `DeliveryLaneSource` is one: it names the seam between
 * "the request presented some bytes" and "those bytes belong to one organization", so
 * the store behind it is one line wide and swappable rather than a query inlined into a
 * route.
 *
 * Contract, every implementation must be fail-closed. Unknown, malformed, revoked,
 * wrong-family and unreadable all resolve to `null`. Never a default organization,
 * never a best-effort match, and never a distinguishable refusal: the caller turns
 * every `null` into one frozen answer (`UNAUTHENTICATED`), so an implementation that
 * threw a describable error instead would be handing an attacker the oracle
 * `./refusals.ts` exists to remove.
 */
export interface McpCredentialSource {
  resolve(presented: string): Promise<McpCredential | null>;
}

/**
 * The credential source this surface runs on: the `api_keys` store, resolved by the
 * repository that owns the table.
 *
 * Ten lines and no decisions of its own. The format gate, the hash lookup and the
 * revocation filter all live inside `resolveApiKeyForRead`, which is context-free by
 * design (the presented material IS the tenant proof; that function's docblock carries
 * the argument). All this adapter does is narrow the resolved row to the one field
 * `McpCredential` has.
 *
 * No try/catch and no cache. See the header; both are requirements, not omissions.
 */
export function createApiKeyMcpCredentials(db: ScopedDb): McpCredentialSource {
  return {
    async resolve(presented: string): Promise<McpCredential | null> {
      const resolved = await resolveApiKeyForRead(db, presented);
      if (resolved === null) {
        return null;
      }

      return { organizationId: resolved.organizationId };
    },
  };
}

/** What a bearer credential looks like on the wire, with the single space that
 * separates the scheme from the material. */
const BEARER_PREFIX = "Bearer ";

/**
 * The credential the request presented, or `null`.
 *
 * Strict, and it guesses at nothing. Only `Authorization: Bearer <material>` counts:
 * not a query parameter (which lands in access logs and browser history), not a cookie
 * (which a browser would attach on its own, making this surface reachable by cross-site
 * request), and not a lower-cased or whitespace-tolerant variant of the scheme. A
 * header we do not recognise is the same as no header, and the caller answers both with
 * the same frozen refusal, so a caller cannot learn the accepted format by probing.
 *
 * The material is not trimmed. Trimming would make two different presented strings
 * resolve to one key, which is the sort of leniency an authentication path never wants.
 */
export function presentedCredential(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const material = header.slice(BEARER_PREFIX.length);
  return material.length > 0 ? material : null;
}
