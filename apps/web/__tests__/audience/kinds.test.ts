// Wave 0 red for ADD O-036 AD-6 (apps/web/lib/audience/kinds.ts — the per-kind template
// tables do not exist yet). Loaded by path so repo-wide typecheck stays green; the schema's
// own kind lists are the source of truth the tables are checked against.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BINDING_FACT_KINDS, businessFactKindSchema } from "@growthmind/shared";
import { describe, expect, test } from "bun:test";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE_PATH = path.join(WEB_ROOT, "lib", "audience", "kinds.ts");

interface KindsModule {
  readonly KIND_LABELS: Record<string, string>;
  readonly CHANGED_LINES: Record<string, string>;
  readonly SETTLED_BY_LINES: Record<string, string>;
}

async function kindsModule(): Promise<KindsModule> {
  if (!existsSync(SOURCE_PATH)) {
    throw new Error(
      "apps/web/lib/audience/kinds.ts does not exist yet, so no kind has a plain-English label, " +
        "a changed line or a settled-by line (ADD O-036 AD-6). This is a Wave 0 red for the " +
        "RIGHT reason.",
    );
  }

  const loaded = (await import(pathToFileURL(SOURCE_PATH).href)) as Record<string, unknown>;
  const missing = ["KIND_LABELS", "CHANGED_LINES", "SETTLED_BY_LINES"].filter(
    (name) => loaded[name] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(`apps/web/lib/audience/kinds.ts exports no ${missing.join(" and no ")} yet.`);
  }

  return loaded as unknown as KindsModule;
}

describe("every kind speaks plain English on the page (FR-9, FR-13)", () => {
  test("should give every one of the twelve kinds a plain-English label with no slug", async () => {
    const { KIND_LABELS } = await kindsModule();
    const kinds = [...businessFactKindSchema.options].toSorted();

    expect(kinds.length).toBe(12);
    expect(Object.keys(KIND_LABELS).toSorted()).toEqual(kinds);

    for (const [kind, label] of Object.entries(KIND_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain("_");
      expect(label).not.toBe(kind);
    }
  });

  test("should give every binding kind a changed line and a settled-by line", async () => {
    const { CHANGED_LINES, SETTLED_BY_LINES } = await kindsModule();
    const binding = [...BINDING_FACT_KINDS].toSorted();

    expect(binding.length).toBe(7);
    expect(Object.keys(CHANGED_LINES).toSorted()).toEqual(binding);
    expect(Object.keys(SETTLED_BY_LINES).toSorted()).toEqual(binding);

    for (const line of [...Object.values(CHANGED_LINES), ...Object.values(SETTLED_BY_LINES)]) {
      expect(line.length).toBeGreaterThan(0);
    }
  });
});
