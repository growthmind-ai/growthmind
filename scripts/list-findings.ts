#!/usr/bin/env bun

import { THRESHOLD_RULE_SETS } from "../packages/core/src/rules/thresholds";
import {
  resolveOrganizationForCli,
  type AdminOrganizationCandidate,
  type ResolveOrganizationResult,
} from "../packages/db/src/admin/index";
import {
  createDb,
  createFindingPayloadsRepo,
  createFindingsRepo,
  createFixesRepo,
  createProjectsRepo,
  describeHold,
  type FindingText,
  type ScopedDb,
} from "../packages/db/src/index";
import {
  parseBaseEnv,
  tenantContextSchema,
  type TenantContext,
} from "../packages/shared/src/index";

const USAGE = [
  "List the findings this organisation has, newest first, and say which can be minted from.",
  "",
  "  bun scripts/list-findings.ts [--limit <n>] [--org <id-or-slug>]",
  "",
  "  --limit <n>         How many to show. Default 10.",
  "  --org <id-or-slug>  Which organisation. Only needed when you have more",
  "                      than one.",
  "  --help              Print this and stop.",
].join("\n");

const DEFAULT_LIMIT = 10;

export interface Arguments {
  readonly limit: number;
  readonly org: string | undefined;
  readonly help: boolean;
  readonly error: string | null;
}

export function parseArguments(argv: readonly string[]): Arguments {
  let limit = DEFAULT_LIMIT;
  let org: string | undefined;
  let help = false;
  let error: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      help = true;
      continue;
    }
    if (flag === "--limit" || flag === "--org") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        error = `${flag} needs a value.`;
        break;
      }
      if (flag === "--limit") {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 1) {
          error = "--limit needs a whole number of one or more.";
          break;
        }
        limit = parsed;
      } else {
        org = value;
      }
      index += 1;
      continue;
    }
    error = `Unknown option ${String(flag)}.`;
    break;
  }

  return { limit, org, help, error };
}

export interface FindingLine {
  readonly findingId: string;
  readonly foundAt: Date;
  readonly text: FindingText;
  readonly surface: string;
  readonly mintable: boolean;
  readonly fixId: string | null;
}

// Names no cause and echoes nothing. The row keeps its other lines, so the count of rows
// printed is unchanged and there is no total to correct.
const WITHHELD_LINE = "(the written explanation for this one is not shown here)";

export function describeFinding(line: FindingLine): readonly string[] {
  const state = line.fixId !== null ? `fix ${line.fixId}` : line.mintable ? "ready" : "no detail";

  return [
    `${line.findingId}   ${line.foundAt.toISOString().slice(0, 16).replace("T", " ")}   ${state}`,
    `  ${line.text.held ? WITHHELD_LINE : line.text.headline}`,
    `  on ${line.surface}`,
  ];
}

// The empty answer is the one an operator meets first, so it names what actually
// produces a finding rather than saying there are none. Thresholds are read, never
// restated, so this cannot drift from the rules the detectors run.
export function nothingFoundYet(): readonly string[] {
  const rules = THRESHOLD_RULE_SETS.get(1);
  if (!rules) throw new Error("threshold rule set version 1 must remain resolvable");

  return [
    "No findings yet. Nothing is broken — we looked, and nothing met the bar.",
    "",
    "Two things can produce one:",
    "",
    `  An error on one page, in ${String(rules.errorMinAffectedSessions)} different visits.`,
    "  Reloading the page yourself does not count: one browser, one visit, however many reloads.",
    "",
    `  People leaving one page without going on, ${String(rules.funnelMinDropoffSessions)} of them,`,
    `  out of at least ${String(rules.funnelMinSessionsAtOrigin)} who got there.`,
    "",
    "Findings are looked for once an hour, so leave time before checking again.",
  ];
}

export async function listFindings(
  db: ScopedDb,
  ctx: TenantContext,
  limit: number,
): Promise<readonly FindingLine[]> {
  const findings = createFindingsRepo(db, ctx);
  const payloads = createFindingPayloadsRepo(db, ctx);
  const fixes = createFixesRepo(db, ctx);

  const collected: FindingLine[] = [];

  for (const project of await createProjectsRepo(db, ctx).list()) {
    for (const finding of await findings.listForProject(project.id, { limit })) {
      const [payload, fix] = await Promise.all([
        payloads.findForFinding(finding.id),
        fixes.findForFinding(finding.id),
      ]);

      // stderr, so `2>/dev/null` leaves a report an operator can paste into a ticket while
      // the person debugging the hold still has the kind.
      if (finding.text.held) {
        const hold = describeHold(finding.text);
        process.stderr.write(
          `finding ${finding.id}: its written text is held (${hold.reason}/${String(hold.kind)}), so the line below it is a placeholder\n`,
        );
      }

      collected.push({
        findingId: finding.id,
        foundAt: finding.createdAt,
        text: finding.text,
        surface: finding.surface,
        mintable: payload !== null,
        fixId: fix?.id ?? null,
      });
    }
  }

  collected.sort((left, right) => right.foundAt.getTime() - left.foundAt.getTime());
  return collected.slice(0, limit);
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
    write("There is no organisation yet, so there are no findings.");
    return;
  }

  if (refusal.reason === "ambiguous") {
    write("You have more than one organisation, so this command will not guess.");
    write("Re-run it with --org and one of these:");
    write("");
    printCandidates(refusal.candidates);
    return;
  }

  if (refusal.reason === "not_found") {
    write("No organisation has that id or slug.");
    write("These are the ones that exist:");
    write("");
    printCandidates(refusal.candidates);
    return;
  }

  write("That organisation has no owner, so there is no person to act as.");
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

    const lines = await listFindings(db, ctx, args.limit);

    write(`Organisation: ${organisation.name} (${organisation.id})`);
    write("");

    if (lines.length === 0) {
      for (const line of nothingFoundYet()) write(line);
      return 0;
    }

    for (const line of lines) {
      for (const rendered of describeFinding(line)) write(rendered);
      write("");
    }

    const ready = lines.filter((line) => line.mintable && line.fixId === null);
    if (ready.length > 0) {
      write(`Open a fix for one:  bun scripts/mint-fix.ts --finding ${ready[0]?.findingId ?? ""}`);
      return 0;
    }

    if (lines.every((line) => line.fixId !== null)) {
      write("Every finding here already has a fix. Your coding agent can pull them over MCP.");
      return 0;
    }

    write("None of these carries the detail a fix needs — they were found before we kept it.");
    write("The next analysis run produces findings that do.");
    return 0;
  } finally {
    await db.$client.end();
  }
}

if (import.meta.main) {
  process.exit(await main());
}
