import type { Origin, WriteKeyKind } from "./types";

const ORIGIN_BY_KIND = {
  standard: "real",
  simulation: "synthetic",
} as const satisfies Record<WriteKeyKind, Origin>;

export function originForKind(kind: WriteKeyKind): Origin {
  return ORIGIN_BY_KIND[kind];
}

export function attributeWriteKey(resolved: { projectId: string; kind: WriteKeyKind }): {
  projectId: string;
  origin: Origin;
} {
  return { projectId: resolved.projectId, origin: originForKind(resolved.kind) };
}
