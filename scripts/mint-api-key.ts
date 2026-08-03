#!/usr/bin/env bun

import {
  resolveOrganizationForCli,
  type AdminOrganizationCandidate,
  type ResolveOrganizationResult,
} from "../packages/db/src/admin/index";
import { createApiKeysRepo, createDb } from "../packages/db/src/index";
import { parseBaseEnv, tenantContextSchema } from "../packages/shared/src/index";

const USAGE = [
  "Mint a read credential for your coding agent.",
  "",
  "  bun scripts/mint-api-key.ts [--org <id-or-slug>] [--name <label>]",
  "",
  "  --org <id-or-slug>  Which organisation to mint for. Only needed when you",
  "                      have more than one.",
  "  --name <label>      A label so you can tell your keys apart later.",
  "  --help              Print this and stop.",
].join("\n");

interface Arguments {
  readonly org: string | undefined;
  readonly name: string | undefined;
  readonly help: boolean;
  readonly error: string | null;
}

function parseArguments(argv: readonly string[]): Arguments {
  let org: string | undefined;
  let name: string | undefined;
  let help = false;
  let error: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      help = true;
      continue;
    }
    if (flag === "--org" || flag === "--name") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        error = `${flag} needs a value.`;
        break;
      }
      if (flag === "--org") {
        org = value;
      } else {
        name = value;
      }
      index += 1;
      continue;
    }
    error = `Unknown option ${String(flag)}.`;
    break;
  }

  return { org, name, help, error };
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
    write("There is no organisation yet, so there is nothing to mint a key for.");
    write("Sign up at http://localhost:3000/sign-up first, then run this again.");
    return;
  }

  if (refusal.reason === "ambiguous") {
    write("You have more than one organisation, so this command will not guess.");
    write("Re-run it with --org and one of these:");
    write("");
    printCandidates(refusal.candidates);
    write("");
    write("  bun scripts/mint-api-key.ts --org <id>");
    return;
  }

  if (refusal.reason === "not_found") {
    write("No organisation has that id or slug. Nothing was minted.");
    write("These are the ones that exist:");
    write("");
    printCandidates(refusal.candidates);
    return;
  }

  write("That organisation has no owner, so there is no person to mint the key as.");
  write("Add an owner to it, then run this again. Nothing was minted.");
}

function defaultKeyName(): string {
  return `read credential (${new Date().toISOString().slice(0, 10)})`;
}

function resolveKeyName(requested: string | undefined): string {
  const trimmed = requested?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : defaultKeyName();
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

    const minted = await createApiKeysRepo(db, ctx).mint({
      name: resolveKeyName(args.name),
    });

    write(`Organisation: ${organisation.name} (${organisation.id})`);
    write(`Key id:       ${minted.key.id}`);
    write(`Key prefix:   ${minted.key.keyPrefix}`);
    write("");
    write(
      "This is the only time you will see this key. Copy it now — it is not stored anywhere you can read it back from.",
    );
    write("");
    write(minted.raw);
    write("");
    write("Give it to your coding agent as an Authorization header:");
    write("  Authorization: Bearer <the key above>");
    write("");
    write(`Revoke it any time with: bun scripts/revoke-api-key.ts --key-id ${minted.key.id}`);

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
  return `Nothing was minted: ${firstLine(messages[0] ?? String(error))}`;
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
