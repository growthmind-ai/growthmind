import type { RrwebEvent } from "@growthmind/shared";

import type { UnknownRecord } from "./parse";
import { RRWEB_NODE_TYPE, asRecord, readReplayEvents } from "./parse";
import type { ElementIdentity } from "./types";

// A recording is untrusted input: the tree walk is capped so a cyclic or
// pathological `childNodes` graph cannot spin.
export const MAX_INDEXED_NODES = 50_000;

export const UNKNOWN_TAG_NAME = "#unknown";

export const CLASS_ATTRIBUTE = "class";
export const ID_ATTRIBUTE = "id";
export const ROLE_ATTRIBUTE = "role";
export const TEST_ID_ATTRIBUTE = "data-testid";

export type NodeIndex = ReadonlyMap<number, ElementIdentity>;

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

function identityOf(node: UnknownRecord): ElementIdentity | null {
  const nodeId = node["id"];
  if (typeof nodeId !== "number" || !Number.isInteger(nodeId)) return null;

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

function collectTree(root: UnknownRecord, into: Map<number, ElementIdentity>): void {
  const pending: UnknownRecord[] = [root];
  let visited = 0;

  while (pending.length > 0 && visited < MAX_INDEXED_NODES) {
    const node = pending.pop();
    if (node === undefined) break;
    visited += 1;

    const identity = identityOf(node);
    if (identity !== null) into.set(identity.nodeId, identity);

    const children = node["childNodes"];
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const record = asRecord(child);
      if (record !== null) pending.push(record);
    }
  }
}

export function indexNodes(events: readonly RrwebEvent[]): NodeIndex {
  const index = new Map<number, ElementIdentity>();

  for (const fact of readReplayEvents(events).facts) {
    if (fact.kind === "snapshot") {
      collectTree(fact.node, index);
      continue;
    }
    if (fact.kind === "mutation") {
      for (const node of fact.adds) collectTree(node, index);
    }
  }

  return index;
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
