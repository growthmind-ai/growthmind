// Source-text scanning for the three grep guards in this lane.
//
// Comments are stripped before every search, deliberately: `posthog/ session-source.ts`
// discusses HogQL and `/query` in its header comment precisely to stop a future
// contributor putting them back on the hot path. A naive grep would fire on the warning
// rather than on a violation.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface AdapterSourceFile {
  /** Posix-style, relative to `packages/adapters/src`. */
  readonly path: string;
  readonly text: string;
  /** `text` with block and whole-line `//` comments removed. */
  readonly code: string;
}

const SRC_ROOT = fileURLToPath(new URL("../../src", import.meta.url));

export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
}

function walk(directory: string, prefix: string, into: AdapterSourceFile[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      walk(join(directory, entry.name), relative, into);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    const text = readFileSync(join(directory, entry.name), "utf8");
    into.push({ path: relative, text, code: stripComments(text) });
  }
}

/** Every `.ts` file under `packages/adapters/src`, read once. */
export function readAdapterSources(): AdapterSourceFile[] {
  const files: AdapterSourceFile[] = [];
  walk(SRC_ROOT, "", files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}
