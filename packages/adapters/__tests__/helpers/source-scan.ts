import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface AdapterSourceFile {
  readonly path: string;
  readonly text: string;

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

export function readAdapterSources(): AdapterSourceFile[] {
  const files: AdapterSourceFile[] = [];
  walk(SRC_ROOT, "", files);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}
