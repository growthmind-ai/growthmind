#!/usr/bin/env bun
/**
 * Revokes one read credential, and lists them so you can find the one to
 * revoke (O-009 FR-17, ADD D-10).
 *
 * READS AND WRITES A REAL DATABASE. NO NETWORK BEYOND IT, NO MODEL.
 *
 * THIN BY CONSTRUCTION, exactly as `mint-api-key.ts` is, and gated by the same
 * committed source scan (`packages/db/__tests__/admin/reachability.test.ts`,
 * "CLI purity"): no random material, no digest, no query builder, no
 * `drizzle-orm` import. Revocation is one `UPDATE … RETURNING` inside
 * `createApiKeysRepo`, keyed on `(organisation, key id)`, so a foreign or
 * nonexistent id matches zero rows and comes back `null` — nothing revoked,
 * nothing mutated, and this script reports exactly that and exits non-zero. A
 * zero-row write reported as success is the class O-006's retro named
 * CRITICAL.
 *
 * REVOCATION IS LIVE ON THE VERY NEXT REQUEST. Nothing caches a resolved
 * credential, by requirement (ADD D-11): the read path looks the digest up on
 * every presentation, and the revocation filter shares one predicate with it.
 *
 * THERE IS NO GUARD ON REVOKING YOUR LAST KEY (OQ-5). If you are here because
 * a key leaked, blocking the response to protect uptime is the wrong default.
 *
 * SEPARATE FILE FROM MINTING ON PURPOSE: the destructive verb has its own
 * filename, so it can never be reached by a typo in a flag on the mint path.
 *
 * Usage:
 *   bun scripts/revoke-api-key.ts --list
 *   bun scripts/revoke-api-key.ts --key-id <id>
 *   bun scripts/revoke-api-key.ts --key-id <id> --org <id-or-slug>
 */
// Imported by RELATIVE PATH — see the note in `mint-api-key.ts`. `scripts/` is
// the one caller allowed to reach the "./admin" subpath (ADD D-9).
import {
  resolveOrganizationForCli,
  type AdminOrganizationCandidate,
  type ResolveOrganizationResult,
} from "../packages/db/src/admin/index";
import { createApiKeysRepo, createDb } from "../packages/db/src/index";
import { parseServerEnv, tenantContextSchema } from "../packages/shared/src/index";

const USAGE = [
  "Revoke a read credential, or list the ones you have.",
  "",
  "  bun scripts/revoke-api-key.ts --list",
  "  bun scripts/revoke-api-key.ts --key-id <id> [--org <id-or-slug>]",
  "",
  "  --key-id <id>       The key to revoke. `--list` prints the ids.",
  "  --list              Show this organisation's keys and stop.",
  "  --org <id-or-slug>  Which organisation. Only needed when you have more",
  "                      than one.",
  "  --help              Print this and stop.",
].join("\n");

interface Arguments {
  readonly keyId: string | undefined;
  readonly org: string | undefined;
  readonly list: boolean;
  readonly help: boolean;
  readonly error: string | null;
}

function parseArguments(argv: readonly string[]): Arguments {
  let keyId: string | undefined;
  let org: string | undefined;
  let list = false;
  let help = false;
  let error: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      help = true;
      continue;
    }
    if (flag === "--list") {
      list = true;
      continue;
    }
    if (flag === "--key-id" || flag === "--org") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        error = `${flag} needs a value.`;
        break;
      }
      if (flag === "--key-id") {
        keyId = value;
      } else {
        org = value;
      }
      index += 1;
      continue;
    }
    error = `Unknown option ${String(flag)}.`;
    break;
  }

  return { keyId, org, list, help, error };
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** This script's own candidate printer — duplicated from `mint-api-key.ts` by
 * decision (ADD D-10), so neither script imports the other and neither puts
 * operator-facing presentation inside `packages/db`. */
function printCandidates(candidates: readonly AdminOrganizationCandidate[]): void {
  for (const candidate of candidates) {
    const owner = candidate.ownerEmail ?? "no owner";
    write(`  ${candidate.id}   ${candidate.name} (${candidate.slug}) — ${owner}`);
  }
}

function printRefusal(refusal: Extract<ResolveOrganizationResult, { ok: false }>): void {
  if (refusal.reason === "none_exist") {
    write("There is no organisation yet, so there are no keys. Nothing was revoked.");
    return;
  }

  if (refusal.reason === "ambiguous") {
    write("You have more than one organisation, so this command will not guess.");
    write("Re-run it with --org and one of these. Nothing was revoked:");
    write("");
    printCandidates(refusal.candidates);
    return;
  }

  if (refusal.reason === "not_found") {
    write("No organisation has that id or slug. Nothing was revoked.");
    write("These are the ones that exist:");
    write("");
    printCandidates(refusal.candidates);
    return;
  }

  write("That organisation has no owner, so there is no person to act as.");
  write("Add an owner to it, then run this again. Nothing was revoked.");
}

async function main(): Promise<number> {
  const args = parseArguments(process.argv.slice(2));

  if (args.error !== null) {
    write(args.error);
    write("");
    write(USAGE);
    return 1;
  }
  if (args.help) {
    write(USAGE);
    return 0;
  }
  if (!args.list && args.keyId === undefined) {
    write("Tell me which key to revoke, or pass --list to see them.");
    write("");
    write(USAGE);
    return 1;
  }

  const env = parseServerEnv(process.env);
  const db = createDb(env.DATABASE_URL);

  try {
    const resolved = await resolveOrganizationForCli(
      db,
      args.org === undefined ? {} : { org: args.org },
    );

    if (!resolved.ok) {
      printRefusal(resolved);
      return 1;
    }

    const organisation = resolved.organization;

    // The same real owner context a signed-in request builds. No system or
    // bypass actor exists in this path, and none is imported.
    const ctx = tenantContextSchema.parse({
      userId: organisation.ownerUserId,
      organizationId: organisation.id,
      organizationName: organisation.name,
      role: "owner",
    });

    const keys = createApiKeysRepo(db, ctx);

    if (args.list) {
      const existing = await keys.list();
      write(`Organisation: ${organisation.name} (${organisation.id})`);
      if (existing.length === 0) {
        write("No keys yet. Mint one with: bun scripts/mint-api-key.ts");
        return 0;
      }
      write(`${existing.length} key${existing.length === 1 ? "" : "s"}:`);
      write("");
      for (const key of existing) {
        const state = key.revokedAt === null ? "live" : `revoked ${key.revokedAt.toISOString()}`;
        write(`  ${key.id}   ${key.keyPrefix}   ${key.name} — ${state}`);
      }
      return 0;
    }

    // `--key-id` is guaranteed present here by the check above; the local keeps
    // that obvious to a reader rather than relying on it.
    const keyId = args.keyId ?? "";
    const revoked = await keys.revoke(keyId);

    if (revoked === null) {
      // Zero rows matched: another organisation's key id, or one that never
      // existed. Both answers are the same sentence and the same exit code —
      // a CLI that distinguished them would tell a caller whether a key id
      // exists somewhere else.
      write("No key with that id in this organisation — nothing was revoked.");
      write("Run with --list to see the ids you do have.");
      return 1;
    }

    write(`Organisation: ${organisation.name} (${organisation.id})`);
    write(`Revoked:      ${revoked.keyPrefix} (${revoked.id})`);
    write(`Revoked at:   ${(revoked.revokedAt ?? new Date()).toISOString()}`);
    write("");
    write("The next request presenting that key gets the same refusal as no key at all.");
    write("Any other key you have keeps working.");

    return 0;
  } finally {
    await db.$client.end();
  }
}

/** Turns the one failure a person actually hits — the database not being up —
 * into a sentence rather than a stack trace. Never prints the connection
 * string, which carries a password.
 *
 * The whole `cause` chain is inspected — messages AND the `code` property —
 * not just the top message. The query layer wraps a connection refusal in its
 * own "Failed query: …" error whose cause is an `AggregateError` with an EMPTY
 * message carrying `code: "ECONNREFUSED"`, so a message-only scan finds
 * nothing and the operator sees SQL they did not write. */
function describeFailure(error: unknown): string {
  const messages: string[] = [];
  const signals: string[] = [];
  let current: unknown = error;
  while (current instanceof Error && signals.length < 8) {
    messages.push(current.message);
    const { code } = current as Error & { code?: unknown };
    signals.push(`${current.message} ${typeof code === "string" ? code : ""}`);
    current = current.cause;
  }
  const message = messages[0] ?? String(error);

  if (
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|terminating connection/i.test(signals.join(" "))
  ) {
    return "Could not reach the database. Start the stack with `docker compose up`, then run this again.";
  }
  return `Nothing was revoked: ${message}`;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`${describeFailure(error)}\n`);
  process.exitCode = 1;
}
