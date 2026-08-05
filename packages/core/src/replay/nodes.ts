import type { RrwebEvent } from "@growthmind/shared";

import type { UnknownRecord } from "./parse";
import { RRWEB_NODE_TYPE, asRecord, readReplayEvents } from "./parse";
import type { ElementIdentity } from "./types";

// A recording is untrusted input: the tree walk is capped so a cyclic or
// pathological `childNodes` graph cannot spin.
export const MAX_INDEXED_NODES = 50_000;

// rrweb names the exact event target, which is routinely an icon, a masked text node or
// a styling wrapper. A person clicks the control those sit inside, so a target is walked
// up to the nearest of these before it is described.
export const INTERACTIVE_TAG_NAMES: readonly string[] = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "summary",
];

export const INTERACTIVE_ROLES: readonly string[] = [
  "button",
  "link",
  "tab",
  "menuitem",
  "checkbox",
  "radio",
  "option",
];

export const INTERACTIVE_TYPE = "submit";

// Deep enough to climb out of an icon and its wrappers, short enough that a click on
// page chrome is never attributed to a container several sections above it.
export const MAX_ANCESTOR_WALK = 5;

export const UNKNOWN_TAG_NAME = "#unknown";

export const CLASS_ATTRIBUTE = "class";
export const ID_ATTRIBUTE = "id";
export const ROLE_ATTRIBUTE = "role";
export const TEST_ID_ATTRIBUTE = "data-testid";
export const TYPE_ATTRIBUTE = "type";

export type NodeIndex = ReadonlyMap<number, ElementIdentity>;

// rrweb renumbers the whole tree on every full snapshot, so one node id names a different
// element in each generation. A segment is one generation: the snapshot that opened it
// plus the nodes mutations added before the next snapshot renumbered everything again.
export type DomSegment = {
  readonly fromTsMs: number;
  readonly index: NodeIndex;
  readonly parents: ReadonlyMap<number, number>;
};

export type DomSegments = readonly DomSegment[];

type SegmentDraft = {
  readonly fromTsMs: number;
  readonly index: Map<number, ElementIdentity>;
  readonly parents: Map<number, number>;

  visited: number;
};

type PendingNode = {
  readonly node: UnknownRecord;
  readonly parentId: number | null;
};

function attributeValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

function readAttributes(value: unknown): Readonly<Record<string, string>> {
  const source = asRecord(value);
  if (source === null) return {};

  const attributes: Record<string, string> = {};
  for (const [name, raw] of Object.entries(source)) {
    const readable = attributeValue(raw);
    if (readable !== null) attributes[name] = readable;
  }
  return attributes;
}

function classesOf(attributes: Readonly<Record<string, string>>): readonly string[] {
  const declared = attributes[CLASS_ATTRIBUTE];
  if (declared === undefined) return [];
  return declared.split(/\s+/).filter((entry) => entry.length > 0);
}

function filled(attributes: Readonly<Record<string, string>>, name: string): string | null {
  const value = attributes[name];
  return value === undefined || value.length === 0 ? null : value;
}

function nodeIdOf(node: UnknownRecord): number | null {
  const nodeId = node["id"];
  return typeof nodeId === "number" && Number.isInteger(nodeId) ? nodeId : null;
}

function identityOf(node: UnknownRecord): ElementIdentity | null {
  const nodeId = nodeIdOf(node);
  if (nodeId === null) return null;

  // Only elements carry identity. Text nodes are masked to asterisks by the
  // recorder, so their content can never name anything.
  if (node["type"] !== RRWEB_NODE_TYPE.element) return null;

  const tagName = node["tagName"];
  if (typeof tagName !== "string" || tagName.length === 0) return null;

  const attributes = readAttributes(node["attributes"]);
  const elementId = filled(attributes, ID_ATTRIBUTE);
  const role = filled(attributes, ROLE_ATTRIBUTE);
  const testId = filled(attributes, TEST_ID_ATTRIBUTE);

  return {
    nodeId,
    tagName: tagName.toLowerCase(),
    classes: classesOf(attributes),
    attributes,
    ...(elementId === null ? {} : { id: elementId }),
    ...(role === null ? {} : { role }),
    ...(testId === null ? {} : { testId }),
  };
}

function collectTree(root: UnknownRecord, rootParentId: number | null, draft: SegmentDraft): void {
  const pending: PendingNode[] = [{ node: root, parentId: rootParentId }];

  while (pending.length > 0 && draft.visited < MAX_INDEXED_NODES) {
    const entry = pending.pop();
    if (entry === undefined) break;
    draft.visited += 1;

    const nodeId = nodeIdOf(entry.node);
    // Masked text nodes get no identity but do get a parent link, because a click on one
    // still has to find the control it sits inside.
    if (nodeId !== null && entry.parentId !== null) draft.parents.set(nodeId, entry.parentId);

    const identity = identityOf(entry.node);
    if (identity !== null) draft.index.set(identity.nodeId, identity);

    const children = entry.node["childNodes"];
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const record = asRecord(child);
      if (record !== null) pending.push({ node: record, parentId: nodeId });
    }
  }
}

export function indexDomSegments(events: readonly RrwebEvent[]): DomSegments {
  const drafts: SegmentDraft[] = [];

  for (const fact of readReplayEvents(events).facts) {
    if (fact.kind === "snapshot") {
      const opened: SegmentDraft = {
        fromTsMs: fact.tsMs,
        index: new Map<number, ElementIdentity>(),
        parents: new Map<number, number>(),
        visited: 0,
      };
      drafts.push(opened);
      collectTree(fact.node, null, opened);
      continue;
    }

    if (fact.kind !== "mutation") continue;

    // A mutation ahead of the first snapshot describes a DOM this recording never showed.
    const open = drafts.at(-1);
    if (open === undefined) continue;
    for (const add of fact.adds) collectTree(add.node, add.parentId, open);
  }

  return drafts.map((draft) => ({
    fromTsMs: draft.fromTsMs,
    index: draft.index,
    parents: draft.parents,
  }));
}

export function unknownIdentity(nodeId: number): ElementIdentity {
  return { nodeId, tagName: UNKNOWN_TAG_NAME, classes: [], attributes: {} };
}

export function isUnknownIdentity(identity: ElementIdentity): boolean {
  return identity.tagName === UNKNOWN_TAG_NAME;
}

export function resolveIdentity(index: NodeIndex, nodeId: number): ElementIdentity {
  return index.get(nodeId) ?? unknownIdentity(nodeId);
}

export function segmentAt(segments: DomSegments, tsMs: number): DomSegment | null {
  let current: DomSegment | null = null;
  for (const segment of segments) {
    if (segment.fromTsMs > tsMs) break;
    current = segment;
  }
  return current;
}

export function resolveIdentityAt(
  segments: DomSegments,
  nodeId: number,
  tsMs: number,
): ElementIdentity {
  const segment = segmentAt(segments, tsMs);
  return segment === null ? unknownIdentity(nodeId) : resolveIdentity(segment.index, nodeId);
}

export function isInteractive(identity: ElementIdentity): boolean {
  if (INTERACTIVE_TAG_NAMES.includes(identity.tagName)) return true;
  if (identity.role !== undefined && INTERACTIVE_ROLES.includes(identity.role)) return true;
  return identity.attributes[TYPE_ATTRIBUTE] === INTERACTIVE_TYPE;
}

export function resolveControlAt(
  segments: DomSegments,
  nodeId: number,
  tsMs: number,
): ElementIdentity {
  const segment = segmentAt(segments, tsMs);
  if (segment === null) return unknownIdentity(nodeId);

  const target = resolveIdentity(segment.index, nodeId);
  if (isInteractive(target)) return target;

  let currentId = nodeId;
  for (let step = 0; step < MAX_ANCESTOR_WALK; step += 1) {
    const parentId = segment.parents.get(currentId);
    if (parentId === undefined) break;

    const ancestor = segment.index.get(parentId);
    if (ancestor !== undefined && isInteractive(ancestor)) return ancestor;
    currentId = parentId;
  }

  return target;
}
