import type { RrwebEvent } from "@growthmind/shared";

export const RRWEB_EVENT_TYPE = {
  fullSnapshot: 2,
  incrementalSnapshot: 3,
  meta: 4,
} as const;

export const RRWEB_INCREMENTAL_SOURCE = {
  mutation: 0,
  mouseInteraction: 2,
  scroll: 3,
  input: 5,
} as const;

export const RRWEB_MOUSE_INTERACTION = {
  click: 2,
  doubleClick: 4,
  focus: 5,
  blur: 6,
} as const;

export const RRWEB_NODE_TYPE = {
  element: 2,
  text: 3,
} as const;

export type UnknownRecord = Readonly<Record<string, unknown>>;

export type MutationAdd = {
  readonly parentId: number | null;
  readonly node: UnknownRecord;
};

export type ReplayFact =
  | { readonly kind: "page"; readonly tsMs: number; readonly href: string }
  | { readonly kind: "snapshot"; readonly tsMs: number; readonly node: UnknownRecord }
  | { readonly kind: "mutation"; readonly tsMs: number; readonly adds: readonly MutationAdd[] }
  | {
      readonly kind: "mouse";
      readonly tsMs: number;
      readonly interaction: number;
      readonly nodeId: number;
    }
  | { readonly kind: "input"; readonly tsMs: number; readonly nodeId: number }
  | {
      readonly kind: "scroll";
      readonly tsMs: number;
      readonly nodeId: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly kind: "other"; readonly tsMs: number };

export type ReadReplayEvents = {
  readonly facts: readonly ReplayFact[];

  readonly dropped: number;
  readonly firstTsMs: number | null;
  readonly lastTsMs: number | null;
};

export function asRecord(value: unknown): UnknownRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function asWholeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asFilledString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function addedNodesOf(value: unknown): readonly MutationAdd[] {
  if (!Array.isArray(value)) return [];

  const adds: MutationAdd[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const node = asRecord(record?.["node"]);
    if (node === null) continue;
    adds.push({ parentId: asWholeNumber(record?.["parentId"]), node });
  }
  return adds;
}

function incrementalFact(tsMs: number, data: UnknownRecord): ReplayFact | null {
  const source = asWholeNumber(data["source"]);
  if (source === null) return null;

  if (source === RRWEB_INCREMENTAL_SOURCE.mutation) {
    return { kind: "mutation", tsMs, adds: addedNodesOf(data["adds"]) };
  }

  if (source === RRWEB_INCREMENTAL_SOURCE.mouseInteraction) {
    const interaction = asWholeNumber(data["type"]);
    const nodeId = asWholeNumber(data["id"]);
    if (interaction === null || nodeId === null) return null;
    return { kind: "mouse", tsMs, interaction, nodeId };
  }

  if (source === RRWEB_INCREMENTAL_SOURCE.input) {
    const nodeId = asWholeNumber(data["id"]);
    if (nodeId === null) return null;
    return { kind: "input", tsMs, nodeId };
  }

  if (source === RRWEB_INCREMENTAL_SOURCE.scroll) {
    const nodeId = asWholeNumber(data["id"]);
    const x = asFiniteNumber(data["x"]);
    const y = asFiniteNumber(data["y"]);
    if (nodeId === null || x === null || y === null) return null;
    return { kind: "scroll", tsMs, nodeId, x, y };
  }

  return { kind: "other", tsMs };
}

function factOf(event: RrwebEvent): ReplayFact | null {
  const tsMs = asFiniteNumber(event.timestamp);
  const type = asWholeNumber(event.type);
  if (tsMs === null || type === null || type < 0) return null;

  const data = asRecord(event.data);

  if (type === RRWEB_EVENT_TYPE.meta) {
    const href = asFilledString(data?.["href"]);
    return href === null ? null : { kind: "page", tsMs, href };
  }

  if (type === RRWEB_EVENT_TYPE.fullSnapshot) {
    const node = asRecord(data?.["node"]);
    return node === null ? null : { kind: "snapshot", tsMs, node };
  }

  if (type === RRWEB_EVENT_TYPE.incrementalSnapshot) {
    return data === null ? null : incrementalFact(tsMs, data);
  }

  return { kind: "other", tsMs };
}

export function readReplayEvents(events: readonly RrwebEvent[]): ReadReplayEvents {
  const facts: ReplayFact[] = [];
  let dropped = 0;

  for (const event of events) {
    const fact = factOf(event);
    if (fact === null) {
      dropped += 1;
      continue;
    }
    facts.push(fact);
  }

  // Stable sort: a page's events can arrive interleaved across pulled pages, and
  // events sharing a millisecond must stay in the order the recorder wrote them.
  const ordered = facts.toSorted((left, right) => left.tsMs - right.tsMs);

  const first = ordered.at(0);
  const last = ordered.at(-1);

  return {
    facts: ordered,
    dropped,
    firstTsMs: first?.tsMs ?? null,
    lastTsMs: last?.tsMs ?? null,
  };
}
