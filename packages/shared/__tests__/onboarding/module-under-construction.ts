export async function loadUnderConstruction<T>(spec: {
  readonly modulePath: string;
  readonly exportName: string;
  readonly ownedBy: string;
}): Promise<T> {
  let namespace: Record<string, unknown>;

  try {
    namespace = (await import(spec.modulePath)) as Record<string, unknown>;
  } catch {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.exportName} — ${spec.modulePath} does not exist on this tree. ` +
        `It is created by ${spec.ownedBy}. This is a Wave 0 red for the RIGHT reason: the ` +
        `behaviour is absent, and the assertion below it is the contract that wave must satisfy.`,
    );
  }

  const value = namespace[spec.exportName];

  if (typeof value !== "function") {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.modulePath} exists but exports no callable \`${spec.exportName}\`. ` +
        `${spec.ownedBy} owns that export. Found: ${typeof value}.`,
    );
  }

  return value as T;
}

export async function loadModuleUnderConstruction(spec: {
  readonly modulePath: string;
  readonly ownedBy: string;
}): Promise<Record<string, unknown>> {
  try {
    return (await import(spec.modulePath)) as Record<string, unknown>;
  } catch {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.modulePath} does not exist on this tree. ` +
        `It is created by ${spec.ownedBy}. This is a Wave 0 red for the RIGHT reason: the ` +
        `behaviour is absent, and the assertions below it are the contract that wave must satisfy.`,
    );
  }
}

export async function loadValueUnderConstruction<T>(spec: {
  readonly modulePath: string;
  readonly exportName: string;
  readonly ownedBy: string;
}): Promise<T> {
  const namespace = await loadModuleUnderConstruction(spec);
  const value = namespace[spec.exportName];

  if (value === undefined) {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.modulePath} exists but exports no \`${spec.exportName}\`. ` +
        `${spec.ownedBy} owns that export.`,
    );
  }

  return value as T;
}

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

export function underConstructionSpecifier(repoRelativePath: string): string {
  return pathToFileURL(path.join(REPO_ROOT, repoRelativePath)).href;
}

export function readSourceUnderConstruction(spec: {
  readonly repoRelativePath: string;
  readonly ownedBy: string;
}): string {
  try {
    return readFileSync(path.join(REPO_ROOT, spec.repoRelativePath), "utf8");
  } catch {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.repoRelativePath} does not exist on this tree, so the ` +
        `structural scan below has nothing to read. It is created by ${spec.ownedBy}. This is a ` +
        `Wave 0 red for the RIGHT reason: the file that must satisfy the invariant is absent.`,
    );
  }
}

export function assertUnderConstruction(
  present: boolean,
  spec: { readonly contract: string; readonly ownedBy: string },
): asserts present {
  if (!present) {
    throw new Error(
      `NOT IMPLEMENTED YET: ${spec.contract}. The module it belongs to already exists on this ` +
        `tree — it is the CONTRACT that is absent, so this red is not a broken import and not a ` +
        `broken fixture. It is created by ${spec.ownedBy}. The assertions below are what that ` +
        `wave must satisfy.`,
    );
  }
}
