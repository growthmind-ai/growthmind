// WHO IS ALLOWED TO READ THIS SURFACE, AND WITH WHAT (O-009).
//
// ===========================================================================
// THE DECISION: AN MCP READ USES A DIFFERENT KIND OF CREDENTIAL FROM EVENT
// INGEST, AND THIS BRANCH HAS NONE, SO THIS SURFACE ADMITS NOBODY YET.
// ===========================================================================
//
// The question the route had to settle is whether a `write_keys` row — the
// credential `resolveWriteKeyForIngest` resolves — may authenticate a read of
// an organization's findings. It may not, and the reason is written into
// `docs/architecture.md` §4.2 in the architecture's own words:
//
//   > Each project issues **public write keys** … A public key is spoofable by
//   > construction — the same accepted risk as every analytics SDK — so the
//   > containment is structural: a key reaches exactly one project, is
//   > rate-limited and rotatable, and anomalous key traffic quarantines rather
//   > than ingests.
//
// Read that containment argument again with a read tool in the picture. It
// holds ONLY because the capability a write key grants is "append activity to
// one project". The blast radius of a stolen write key is junk telemetry in one
// project, which quarantine handles. A write key that also granted
// `list_open_fixes` would have a blast radius of EVERY FINDING IN THE
// ORGANIZATION — the growth problems, the counts, the evidence, the fix
// instructions — handed to anyone who opened the customer's page source,
// because that key ships in the customer's browser. It is published, by design,
// on the public internet. There is no version of that trade that is acceptable,
// and no amount of rate limiting makes a published credential a read
// credential.
//
// Both KINDS are equally disqualified, and for the same reason rather than by
// listing them: `writeKeyKindSchema` is `["standard", "simulation"]`
// (`packages/shared/src/write-keys/types.ts`) and the two differ only in the
// `origin` the server stamps on what they ingest (§4.2, §4.11). Neither means
// "a person deliberately handed this to an agent". Both are carried by a
// website's own code.
//
// The credential this surface actually wants already has a name in the data
// model: `api_keys`, listed beside `write_keys` in `docs/architecture.md` §6
// as a separate table precisely because it is a separate thing. It does not
// exist in this branch's schema.
//
// ---------------------------------------------------------------------------
// SO WHAT THIS FILE DOES: FAIL CLOSED, VISIBLY, WITH THE GATE REAL
// ---------------------------------------------------------------------------
//
// `MCP_ADMISSIBLE_WRITE_KEY_KINDS` is the list of write-key kinds this surface
// accepts. It is EMPTY, and it is the honest length: there is no member of
// `WriteKeyKind` that a person hands to a coding agent.
//
// The gate around it is real and runs for real. `createWriteKeyMcpCredentials`
// resolves the presented string exactly as ingest does — `isWriteKeyFormat`
// first so a malformed string never reaches the database, then the hash lookup,
// then the revocation filter, all inside `resolveWriteKeyForIngest` — and only
// then asks whether the KIND is admissible here. It does not short-circuit on
// the empty list, and that is deliberate: a short-circuit would make the kind
// check unreachable, and the named test that proves a genuine, unrevoked,
// correctly-formatted `standard` key is refused would then be proving nothing.
// The test mints a real key against a real database and asserts the refusal is
// byte-identical to presenting no key at all, and separately asserts that the
// same key DOES resolve through `resolveWriteKeyForIngest` — so the refusal is
// demonstrably this gate, and not a broken fixture.
//
// WHAT THIS MEANS TODAY, SAID OUT LOUD: no credential in this branch can call
// this surface. Every request is refused. That is the same graceful-absence
// shape `resolveDeliveryComposition` in `worker/src/index.ts` holds open for
// the delivery lane — the behaviour is built, proven through the real entry
// point with fakes, and not yet reachable in production because a table it
// needs has not been built. It is stated here rather than hidden, because the
// alternative — admitting `standard` keys so the endpoint "works" — is the
// single worst thing this outcome could ship.
//
// WHAT UNBLOCKS IT: an `api_keys` table (`docs/architecture.md` §6) with a
// repository resolving a presented key to its organization, fail-closed on
// unknown/revoked exactly as `resolveWriteKeyForIngest` is. That becomes a
// second implementation of `McpCredentialSource` and `resolveMcpDeps` in
// `../../app/api/mcp/route.ts` returns it instead. Nothing else in this
// directory changes, because everything downstream of here reads only
// `credential.organizationId`.
//
// IF SOMEBODY LATER ADDS AN AGENT-FACING KIND TO `writeKeyKindSchema`, adding
// it to the list below is a deliberate, reviewable, one-line act — and the
// named test `admits no kind of key that a website's own code carries` fails
// the moment an ingest kind is added to it.
import { resolveWriteKeyForIngest, type ScopedDb } from "@growthmind/db";
import type { WriteKeyKind } from "@growthmind/shared";

/**
 * What authentication produces, and the ONLY thing it produces.
 *
 * One field, on purpose. Every read below it is scoped by this organization id
 * and by nothing else the caller said, so there is no second field a handler
 * could accidentally prefer over it. The project id the presented credential
 * may also carry is deliberately NOT here: `list_open_fixes` takes an optional
 * `projectId` argument, and a credential-borne project would silently either
 * override or contradict it.
 */
export interface McpCredential {
  readonly organizationId: string;
}

/**
 * Turning a presented string into an organization, or into nothing.
 *
 * A PORT, for the same reason `DeliveryLaneSource` is one: the store this
 * surface's real credentials will live in does not exist in this branch, and
 * naming the seam keeps the gap one line wide and visible instead of inlining
 * a query that would have to be unpicked later.
 *
 * CONTRACT — every implementation must be fail-closed. Unknown, malformed,
 * revoked, wrong-kind and unreadable all resolve to `null`. Never a default
 * organization, never a best-effort match, and never a distinguishable
 * refusal: the caller turns every `null` into one frozen answer
 * (`UNAUTHENTICATED`), so an implementation that threw a describable error
 * instead would be handing an attacker the oracle `./refusals.ts` exists to
 * remove.
 */
export interface McpCredentialSource {
  resolve(presented: string): Promise<McpCredential | null>;
}

/**
 * The write-key kinds admissible on the read surface. EMPTY, and see the header
 * for why — every value of `WriteKeyKind` is a credential a website's own code
 * carries in public.
 *
 * Typed `readonly WriteKeyKind[]` rather than `[] as const` so adding a kind is
 * a compile-checked act against the union `@growthmind/shared` owns, not a free
 * string.
 */
export const MCP_ADMISSIBLE_WRITE_KEY_KINDS: readonly WriteKeyKind[] = [];

/**
 * The credential source backed by the only credential store this branch has.
 *
 * It reaches the database on every well-formed presentation, and that is
 * correct rather than wasteful: it is one lookup on a unique index, it is what
 * the real thing will do, and skipping it because the admissible list happens
 * to be empty today would make this gate untestable (see the header).
 *
 * A malformed presentation never reaches the database at all —
 * `resolveWriteKeyForIngest` runs `isWriteKeyFormat` first.
 */
export function createWriteKeyMcpCredentials(db: ScopedDb): McpCredentialSource {
  return {
    async resolve(presented: string): Promise<McpCredential | null> {
      const resolved = await resolveWriteKeyForIngest(db, presented);
      if (resolved === null) {
        return null;
      }

      // THE KIND GATE. Reached only by a genuine, unrevoked key — and it
      // refuses every one of them, because no ingest kind is a read
      // credential. The organization id is read only past this line, so a
      // refused kind never scopes anything.
      if (!MCP_ADMISSIBLE_WRITE_KEY_KINDS.includes(resolved.kind)) {
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
 * STRICT, AND IT GUESSES AT NOTHING. Only `Authorization: Bearer <material>`
 * counts: not a query parameter (which lands in access logs and browser
 * history), not a cookie (which a browser would attach on its own, making this
 * surface reachable by cross-site request), and not a lower-cased or
 * whitespace-tolerant variant of the scheme. A header we do not recognise is
 * the same as no header, and the caller answers both with the same frozen
 * refusal — so a caller cannot learn the accepted format by probing.
 *
 * The material is NOT trimmed. Trimming would make two different presented
 * strings resolve to one key, which is the sort of leniency an authentication
 * path never wants.
 */
export function presentedCredential(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null || !header.startsWith(BEARER_PREFIX)) {
    return null;
  }

  const material = header.slice(BEARER_PREFIX.length);
  return material.length > 0 ? material : null;
}
