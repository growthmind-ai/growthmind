import type { Origin, WriteKeyKind } from "./types";

/**
 * Exhaustive over `WriteKeyKind` — adding a new kind without a branch here is
 * a compile error (D10), never a silent runtime default.
 */
const ORIGIN_BY_KIND = {
  standard: "real",
  simulation: "synthetic",
} as const satisfies Record<WriteKeyKind, Origin>;

/** `standard` → `real`, `simulation` → `synthetic` (FR-6). */
export function originForKind(kind: WriteKeyKind): Origin {
  return ORIGIN_BY_KIND[kind];
}

/**
 * D-F/D10 — this is the whole guarantee: the signature accepts ONLY the
 * resolved key row. No payload, header, or override parameter may exist in
 * the signature — the unoverridability is enforced by the type, not by a
 * runtime check. Callers cannot pass anything but `{ projectId, kind }`.
 */
export function attributeWriteKey(resolved: { projectId: string; kind: WriteKeyKind }): {
  projectId: string;
  origin: Origin;
} {
  return { projectId: resolved.projectId, origin: originForKind(resolved.kind) };
}
