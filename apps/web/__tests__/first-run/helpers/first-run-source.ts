import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readSourceUnderConstruction } from "../../../../../packages/shared/__tests__/onboarding/module-under-construction";

const REPO_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "..",
);

export interface FirstRunFile {
  readonly repoRelativePath: string;

  readonly ownedBy: string;
}

const OWNER_7A = "ADD Wave 7a (frontend — the sequence, the forms, the receipt)";
const OWNER_7B = "ADD Wave 7b (frontend — the client, the strip, the stage, the styles)";
const OWNER_O024 = "ADD O-024 AD-8 (frontend — the chip machine, the chip row, the soon card)";
const OWNER_O026 =
  "ADD O-026 D-11/D-12 (frontend — the multi-line copy primitive and the agent panel trio)";

const entry = (repoRelativePath: string, ownedBy: string): FirstRunFile => ({
  repoRelativePath,
  ownedBy,
});

export const CHIP_STATE = entry("apps/web/components/first-run/chip-state.ts", OWNER_O024);

export const PROVIDER_CHIPS = entry("apps/web/components/first-run/ProviderChips.tsx", OWNER_O024);

export const SOON_CARD = entry("apps/web/components/first-run/SoonCard.tsx", OWNER_O024);

export const STEP_ROW = entry("apps/web/components/first-run/StepRow.tsx", OWNER_7A);

export const COUNTER_GRID = entry("apps/web/components/first-run/CounterGrid.tsx", OWNER_7A);

export const STAGE = entry("apps/web/components/first-run/Stage.tsx", OWNER_7B);

export const WAIT_LOG = entry("apps/web/components/first-run/WaitLog.tsx", OWNER_7B);

/**
 * Named because AD-6's wire test reads this one file by name. It sits outside
 * `components/first-run/` because the settings page mounts it too, and stays in
 * the scans below because every one of them is about the card, not the surface.
 */
export const SLACK_CONNECTION = entry("apps/web/components/slack/SlackConnection.tsx", OWNER_7A);

export const FINDING_CARD = entry("apps/web/components/first-run/FindingCard.tsx", OWNER_7B);

export const COPYABLE_BLOCK = entry("apps/web/components/ui/CopyableBlock.tsx", OWNER_O026);

export const AGENT_PANEL_STATE = entry(
  "apps/web/components/first-run/agent-panel-state.ts",
  OWNER_O026,
);

export const AGENT_PANEL_BODY = entry(
  "apps/web/components/first-run/AgentPanelBody.tsx",
  OWNER_O026,
);

export const AGENT_PANEL = entry("apps/web/components/first-run/AgentPanel.tsx", OWNER_O026);

export const FIRST_RUN_CSS = entry("apps/web/components/first-run/first-run.module.css", OWNER_7B);

export const FIRST_RUN_PAGE = entry("apps/web/app/(first-run)/first-run/page.tsx", OWNER_7A);

export const LANDING_PAGE = entry("apps/web/app/page.tsx", OWNER_7A);

export const FIRST_RUN_COMPONENTS: readonly FirstRunFile[] = [
  CHIP_STATE,
  PROVIDER_CHIPS,
  SOON_CARD,
  entry("apps/web/components/first-run/Roadmap.tsx", OWNER_7A),
  STEP_ROW,
  entry("apps/web/components/first-run/FieldRow.tsx", OWNER_7A),
  entry("apps/web/components/first-run/ConnectAnalyticsForm.tsx", OWNER_7A),
  COUNTER_GRID,
  entry("apps/web/components/first-run/PrivacyReceipt.tsx", OWNER_7A),
  SLACK_CONNECTION,
  entry("apps/web/components/first-run/FirstRunClient.tsx", OWNER_7B),
  entry("apps/web/components/first-run/Strip.tsx", OWNER_7B),
  STAGE,
  WAIT_LOG,
  FINDING_CARD,
  COPYABLE_BLOCK,
  AGENT_PANEL_STATE,
  AGENT_PANEL_BODY,
  AGENT_PANEL,
];

export const FIRST_RUN_ROUTE_FILES: readonly FirstRunFile[] = [
  FIRST_RUN_PAGE,
  entry("apps/web/app/(first-run)/first-run/layout.tsx", OWNER_7A),
];

export const FIRST_RUN_TREE: readonly FirstRunFile[] = [
  ...FIRST_RUN_COMPONENTS,
  ...FIRST_RUN_ROUTE_FILES,
];

export interface ScannedFile {
  readonly file: string;
  readonly source: string;
}

export function readFirstRun(file: FirstRunFile): ScannedFile {
  return {
    file: file.repoRelativePath,
    source: readSourceUnderConstruction({
      repoRelativePath: file.repoRelativePath,
      ownedBy: file.ownedBy,
    }),
  };
}

export function readAll(files: readonly FirstRunFile[]): readonly ScannedFile[] {
  return files.map((file) => readFirstRun(file));
}

export function readExisting(repoRelativePath: string): ScannedFile {
  return {
    file: repoRelativePath,
    source: readFileSync(path.join(REPO_ROOT, repoRelativePath), "utf8"),
  };
}

const WALK_SKIP = new Set(["node_modules", ".next", "dist", ".turbo"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

export function webSourceFiles(): readonly string[] {
  const root = path.join(REPO_ROOT, "apps", "web");
  const found: string[] = [];

  const walk = (absolute: string): void => {
    for (const item of readdirSync(absolute, { withFileTypes: true })) {
      if (item.isDirectory()) {
        if (WALK_SKIP.has(item.name) || item.name === "__tests__") continue;
        walk(path.join(absolute, item.name));
        continue;
      }
      if (SOURCE_EXTENSIONS.has(path.extname(item.name)))
        found.push(path.join(absolute, item.name));
    }
  };

  walk(root);

  return found
    .map((absolute) => path.relative(REPO_ROOT, absolute).split(path.sep).join("/"))
    .toSorted();
}

export function webSources(): readonly ScannedFile[] {
  return webSourceFiles().map((file) => readExisting(file));
}

type WalkState = "code" | "line" | "block" | "single" | "double" | "template";

interface Channels {
  readonly blanked: string;

  readonly comments: string;
}

function channels(source: string): Channels {
  const blanked: string[] = [];
  const comments: string[] = [];
  let state: WalkState = "code";

  const push = (ch: string, isComment: boolean): void => {
    if (ch === "\n") {
      blanked.push("\n");
      comments.push("\n");
      return;
    }
    blanked.push(isComment ? " " : ch);
    comments.push(isComment ? ch : " ");
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] ?? "";
    const next = source[i + 1];

    if (ch === "\n") {
      push(ch, false);
      if (state === "line") state = "code";
      continue;
    }

    switch (state) {
      case "code": {
        if (ch === "/" && next === "/") {
          state = "line";
          push(" ", true);
          push(" ", true);
          i += 1;
        } else if (ch === "/" && next === "*") {
          state = "block";
          push(" ", true);
          push(" ", true);
          i += 1;
        } else {
          if (ch === '"') state = "double";
          else if (ch === "'") state = "single";
          else if (ch === "`") state = "template";
          push(ch, false);
        }
        break;
      }
      case "line": {
        push(ch, true);
        break;
      }
      case "block": {
        if (ch === "*" && next === "/") {
          push(" ", true);
          push(" ", true);
          state = "code";
          i += 1;
        } else push(ch, true);
        break;
      }
      case "single": {
        push(ch, false);
        if (ch === "\\") {
          const escaped = source[i + 1];
          if (escaped !== undefined) push(escaped, false);
          i += 1;
        } else if (ch === "'") state = "code";
        break;
      }
      case "double": {
        push(ch, false);
        if (ch === "\\") {
          const escaped = source[i + 1];
          if (escaped !== undefined) push(escaped, false);
          i += 1;
        } else if (ch === '"') state = "code";
        break;
      }
      case "template": {
        push(ch, false);
        if (ch === "\\") {
          const escaped = source[i + 1];
          if (escaped !== undefined) push(escaped, false);
          i += 1;
        } else if (ch === "`") state = "code";
        break;
      }
    }
  }

  return { blanked: blanked.join(""), comments: comments.join("") };
}

export function blankComments(source: string): string {
  return channels(source).blanked;
}

export function commentsOnly(source: string): string {
  return channels(source).comments;
}

export type Channel = "code" | "comments" | "raw";

const channelOf = (source: string, channel: Channel): string =>
  channel === "code"
    ? blankComments(source)
    : channel === "comments"
      ? commentsOnly(source)
      : source;

export function offenders(
  files: readonly ScannedFile[],
  pattern: RegExp,
  channel: Channel = "code",
): readonly string[] {
  const flags = pattern.flags.replace("g", "");
  const found: string[] = [];

  for (const scanned of files) {
    const lines = channelOf(scanned.source, channel).split("\n");
    for (const [index, line] of lines.entries()) {
      if (new RegExp(pattern.source, flags).test(line)) {
        found.push(`${scanned.file}:${index + 1} → ${line.trim()}`);
      }
    }
  }

  return found;
}

export function anyMatch(
  files: readonly ScannedFile[],
  pattern: RegExp,
  channel: Channel = "code",
): boolean {
  return files.some((scanned) => pattern.test(channelOf(scanned.source, channel)));
}

export function fixture(name: string, source: string): ScannedFile {
  return { file: `apps/web/components/first-run/__${name}__.tsx`, source };
}

export function fixtureAt(repoRelativePath: string, source: string): ScannedFile {
  return { file: repoRelativePath, source };
}
