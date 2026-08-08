import type { RrwebEvent } from "@growthmind/shared";

import { deliverableName, deliverableValue, isMaskedText } from "./describe-value";
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
export const LABEL_FOR_ATTRIBUTE = "for";
export const ARIA_HIDDEN_ATTRIBUTE = "aria-hidden";
export const ARIA_HIDDEN_VALUE = "true";
export const LABEL_TAG_NAME = "label";

// None of these render, so none of them names anything. It is also how rrweb's own
// `SCRIPT_PLACEHOLDER` substitution stays out of a digest: it is the text node of a
// <script>, so excluding the subtree excludes the sentinel without naming it.
export const UNNAMED_TAG_NAMES: readonly string[] = ["script", "style", "noscript", "template"];

export const PAGE_ROOT_TAG_NAMES: readonly string[] = ["body", "html"];

// Elements whose own text is chrome a developer wrote rather than a row of data, so a name from
// one may be a phrase. Every other element's text stays one token, <a> included — a link's text
// is as often a person's name as a label (.ai/decisions/0025-multi-word-accessible-names.md).
export const AUTHORED_TEXT_TAG_NAMES: readonly string[] = ["button", "label"];
export const AUTHORED_TEXT_ROLE = "button";

export type NodeIndex = ReadonlyMap<number, ElementIdentity>;

// rrweb renumbers the whole tree on every full snapshot, so one node id names a different
// element in each generation. A segment is one generation: the snapshot that opened it
// plus the nodes mutations added before the next snapshot renumbered everything again.
export type DomSegment = {
  readonly fromTsMs: number;
  readonly index: NodeIndex;
  readonly parents: ReadonlyMap<number, number>;

  // When a mutation put a node into this generation. Absent for anything the snapshot opened
  // with, which is the distinction between a field a person has been looking at and one that
  // has only just mounted (B-060).
  readonly addedAt: ReadonlyMap<number, number>;
};

export type DomSegments = readonly DomSegment[];

type SegmentDraft = {
  readonly fromTsMs: number;
  readonly index: Map<number, ElementIdentity>;
  readonly parents: Map<number, number>;
  readonly addedAt: Map<number, number>;

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

export function isUnnamed(node: UnknownRecord): boolean {
  const tagName = node["tagName"];
  if (typeof tagName === "string" && UNNAMED_TAG_NAMES.includes(tagName.toLowerCase())) return true;

  const attributes = asRecord(node["attributes"]);
  return attributes?.[ARIA_HIDDEN_ATTRIBUTE] === ARIA_HIDDEN_VALUE;
}

// A control's own rendered text, read the same distance down that resolveControlAt walks up:
// its label sits inside its wrappers, never several sections away. Each child contributes a
// separate word, so two adjacent spans read as the two words a person sees rather than as one
// token that appears nowhere on the page.
function renderedText(node: UnknownRecord, depth: number): readonly string[] {
  if (isUnnamed(node)) return [];

  if (node["type"] === RRWEB_NODE_TYPE.text) {
    const content = node["textContent"];
    if (typeof content !== "string" || isMaskedText(content)) return [];
    return [content];
  }

  const children = node["childNodes"];
  if (depth >= MAX_ANCESTOR_WALK || !Array.isArray(children)) return [];

  const parts: string[] = [];
  for (const child of children) {
    const record = asRecord(child);
    if (record !== null) parts.push(...renderedText(record, depth + 1));
  }
  return parts;
}

// Only a control is named. Text elsewhere is page copy, so a divider's "or" and a heading are
// never mistaken for something the person acted on, and no length rule is needed to say so.
// Both gates refuse masked text, which is asterisks, and a typed value is never read at all.
function accessibleNameOf(identity: ElementIdentity, node: UnknownRecord): string | null {
  if (!isInteractive(identity)) return null;

  const text = renderedText(node, 0).join(" ");
  const authored =
    AUTHORED_TEXT_TAG_NAMES.includes(identity.tagName) || identity.role === AUTHORED_TEXT_ROLE;

  return authored ? deliverableName(text) : deliverableValue(text);
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

  const identity: ElementIdentity = {
    nodeId,
    tagName: tagName.toLowerCase(),
    classes: classesOf(attributes),
    attributes,
    ...(elementId === null ? {} : { id: elementId }),
    ...(role === null ? {} : { role }),
    ...(testId === null ? {} : { testId }),
  };

  const accessibleName = accessibleNameOf(identity, node);
  return accessibleName === null ? identity : { ...identity, accessibleName };
}

function collectTree(
  root: UnknownRecord,
  rootParentId: number | null,
  draft: SegmentDraft,
  addedAtMs: number | null = null,
): void {
  const pending: PendingNode[] = [{ node: root, parentId: rootParentId }];

  while (pending.length > 0 && draft.visited < MAX_INDEXED_NODES) {
    const entry = pending.pop();
    if (entry === undefined) break;
    draft.visited += 1;

    const nodeId = nodeIdOf(entry.node);
    // Masked text nodes get no identity but do get a parent link, because a click on one
    // still has to find the control it sits inside.
    if (nodeId !== null && entry.parentId !== null) draft.parents.set(nodeId, entry.parentId);
    if (nodeId !== null && addedAtMs !== null && !draft.addedAt.has(nodeId)) {
      draft.addedAt.set(nodeId, addedAtMs);
    }

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

function labelNamesByFor(draft: SegmentDraft): ReadonlyMap<string, string> {
  const named = new Map<string, string>();

  for (const identity of draft.index.values()) {
    if (identity.tagName !== LABEL_TAG_NAME || identity.accessibleName === undefined) continue;

    const bound = identity.attributes[LABEL_FOR_ATTRIBUTE];
    if (bound === undefined || named.has(bound)) continue;
    named.set(bound, identity.accessibleName);
  }

  return named;
}

function enclosingLabelName(draft: SegmentDraft, nodeId: number): string | null {
  let currentId = nodeId;

  for (let step = 0; step < MAX_ANCESTOR_WALK; step += 1) {
    const parentId = draft.parents.get(currentId);
    if (parentId === undefined) return null;

    const ancestor = draft.index.get(parentId);
    if (ancestor?.tagName === LABEL_TAG_NAME) return ancestor.accessibleName ?? null;
    currentId = parentId;
  }

  return null;
}

// A field's own text is empty, so its name is the label bound to it — the highest-value source
// on a form and the one that survives a build tool renaming every class. Deferred to here
// because a label can be indexed after the control it names, or by a later mutation.
function bindLabelNames(draft: SegmentDraft): void {
  const named = labelNamesByFor(draft);

  for (const [nodeId, identity] of draft.index) {
    if (identity.accessibleName !== undefined || !isInteractive(identity)) continue;

    const bound =
      (identity.id === undefined ? undefined : named.get(identity.id)) ??
      enclosingLabelName(draft, nodeId);
    if (bound === undefined || bound === null) continue;

    draft.index.set(nodeId, { ...identity, accessibleName: bound });
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
        addedAt: new Map<number, number>(),
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
    for (const add of fact.adds) collectTree(add.node, add.parentId, open, fact.tsMs);
  }

  return drafts.map((draft) => {
    bindLabelNames(draft);

    return {
      fromTsMs: draft.fromTsMs,
      index: draft.index,
      parents: draft.parents,
      addedAt: draft.addedAt,
    };
  });
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

// The identity-side twin of `isUnnamed`, for a container reached through the index rather than
// walked as a raw node: text landing under <style> or inside an aria-hidden branch never rendered.
export function isRenderedContainer(identity: ElementIdentity): boolean {
  if (UNNAMED_TAG_NAMES.includes(identity.tagName)) return false;
  return identity.attributes[ARIA_HIDDEN_ATTRIBUTE] !== ARIA_HIDDEN_VALUE;
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
