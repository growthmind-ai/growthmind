#!/usr/bin/env bun

import {
  resolveOrganizationForCli,
  type AdminOrganizationCandidate,
  type ResolveOrganizationResult,
} from "../packages/db/src/admin/index";
import {
  createDb,
  createFixesService,
  type FixesService,
  type OpenFixResult,
} from "../packages/db/src/index";
import { parseBaseEnv, tenantContextSchema } from "../packages/shared/src/index";

const USAGE = [
  "Open a fix for a finding, the same way the Slack button does.",
  "",
  "  bun scripts/mint-fix.ts --finding <id> [--org <id-or-slug>]",
  "",
  "  --finding <id>      The finding to open a fix for.",
  "  --org <id-or-slug>  Which organisation. Only needed when you have more",
  "                      than one.",
  "  --help              Print this and stop.",
].join("\n");

export interface Arguments {
  readonly finding: string | undefined;
  readonly org: string | undefined;
  readonly help: boolean;
  readonly error: string | null;
}

export function parseArguments(argv: readonly string[]): Arguments {
  let finding: string | undefined;
  let org: string | undefined;
  let help = false;
  let error: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      help = true;
      continue;
    }
    if (flag === "--finding" || flag === "--org") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        error = `${flag} needs a value.`;
        break;
      }
      if (flag === "--finding") {
        finding = value;
      } else {
        org = value;
      }
      index += 1;
      continue;
    }
    error = `Unknown option ${String(flag)}.`;
    break;
  }

  return { finding, org, help, error };
}

export interface MintReport {
  readonly lines: readonly string[];
  readonly code: number;
}

// Total over the closed union, so a sixth outcome fails to compile rather than
// reaching an operator as silence.
export function reportFor(result: OpenFixResult): MintReport {
  switch (result.outcome) {
    case "opened":
      return {
        code: 0,
        lines: [
          "opened — the fix is minted and your coding agent can pick it up.",
          `Fix id: ${result.fix.id}`,
          "",
          "Ask your coding agent to work on your open fixes, or call get_fix with that id.",
        ],
      };

    case "already_open":
      return {
        code: 0,
        lines: [
          "already_open — this finding already had a fix, so nothing new was minted.",
          `Fix id: ${result.fix.id}`,
          "",
          "That fix is the one your coding agent will pick up. Pressing the Slack button again does the same nothing.",
        ],
      };

    case "no_payload":
      return {
        code: 1,
        lines: [
          "no_payload — this finding was found before we started keeping the detail a coding agent needs, so no fix was minted.",
          "",
          "Nothing is broken, and this is the expected answer for any finding older than that change.",
          "The next analysis run produces findings that carry the detail. Mint from one of those.",
        ],
      };

    case "unrenderable":
      return {
        code: 1,
        lines: [
          "unrenderable — the detail stored with this finding could not be turned into a fix spec, so no fix was minted.",
          "",
          "We check that at the mint on purpose: a fix that exists but cannot be read back is worse than no fix.",
          "The run that wrote it logged why. Mint from a newer finding.",
        ],
      };

    case "finding_not_found":
      return {
        code: 1,
        lines: [
          "finding_not_found — no finding has that id in this organisation, so nothing was minted.",
          "",
          "Check the id, and check you are pointed at the right organisation with --org.",
        ],
      };

    case "surface_forbidden":
      return {
        code: 1,
        lines: [
          `surface_forbidden — ${result.surface} is a ${result.reason} page, so no fix was minted.`,
          "",
          "Product decisions §5: we never propose changes to pricing, billing, auth, consent or terms.",
          "The finding itself is unaffected and still delivers. The change is the customer's to make.",
          "If this page is genuinely theirs to change, add it to the project's confirmed-changeable list.",
        ],
      };
  }
}

export async function mintFix(service: FixesService, findingId: string): Promise<MintReport> {
  return reportFor(await service.openFor(findingId));
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
    write("There is no organisation yet, so there are no findings. Nothing was minted.");
    return;
  }

  if (refusal.reason === "ambiguous") {
    write("You have more than one organisation, so this command will not guess.");
    write("Re-run it with --org and one of these. Nothing was minted:");
    write("");
    printCandidates(refusal.candidates);
    return;
  }

  if (refusal.reason === "not_found") {
    write("No organisation has that id or slug. Nothing was minted.");
    write("These are the ones that exist:");
    write("");
    printCandidates(refusal.candidates);
    return;
  }

  write("That organisation has no owner, so there is no person to act as.");
  write("Add an owner to it, then run this again. Nothing was minted.");
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
  if (args.finding === undefined) {
    write("Tell me which finding to open a fix for.");
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

    const report = await mintFix(createFixesService(db, ctx), args.finding);

    write(`Organisation: ${organisation.name} (${organisation.id})`);
    write(`Finding:      ${args.finding}`);
    write("");
    for (const line of report.lines) {
      write(line);
    }

    return report.code;
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

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    process.stderr.write(`${describeFailure(error)}\n`);
    process.exitCode = 1;
  }
}
