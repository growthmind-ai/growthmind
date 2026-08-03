#!/usr/bin/env bun

import {
  resolveOrganizationForCli,
  type AdminOrganizationCandidate,
  type ResolveOrganizationResult,
} from "../packages/db/src/admin/index";
import { createApiKeysRepo, createDb } from "../packages/db/src/index";
import { parseBaseEnv, tenantContextSchema } from "../packages/shared/src/index";

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

  const env = parseBaseEnv(process.env);
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

    const keyId = args.keyId ?? "";
    const revoked = await keys.revoke(keyId);

    if (revoked === null) {
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

  if (
    /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|terminating connection/i.test(signals.join(" "))
  ) {
    return "Could not reach the database. Start the stack with `docker compose up`, then run this again.";
  }
  return `Nothing was revoked: ${firstLine(messages[0] ?? String(error))}`;
}

function firstLine(message: string): string {
  return message.split("\n")[0] ?? message;
}

try {
  process.exitCode = await main();
} catch (error) {
  process.stderr.write(`${describeFailure(error)}\n`);
  process.exitCode = 1;
}
