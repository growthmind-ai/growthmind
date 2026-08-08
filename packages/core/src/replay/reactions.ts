import { deliverableSentence, isMaskedText } from "./describe-value";
import type { DomSegment, DomSegments } from "./nodes";
import {
  MAX_ANCESTOR_WALK,
  MAX_INDEXED_NODES,
  PAGE_ROOT_TAG_NAMES,
  ROLE_ATTRIBUTE,
  isRenderedContainer,
  isUnnamed,
  resolveControlAt,
  resolveIdentityAt,
  segmentAt,
} from "./nodes";
import type { MutationAdd, ReplayFact, UnknownRecord } from "./parse";
import { RRWEB_MOUSE_INTERACTION, RRWEB_NODE_TYPE, asRecord } from "./parse";
import type { ReactionAction, ReactionKind } from "./types";

export const ALERT_ROLE_VALUE = "alert";

export const ARIA_LIVE_ATTRIBUTE = "aria-live";

export const ARIA_ERROR_MESSAGE_ATTRIBUTE = "aria-errormessage";

export type ReactionDraft = {
  readonly atMs: number;

  readonly order: number;
  readonly action: ReactionAction;
};

// The one precedence statement, and no window in it: text the DOM gained between one interaction
// and the next is that interaction's answer. It is taken from the first of these to yield
// anything and never from a later one — (1) a container the app announces, which is the DOM's own
// word for "read this back"; (2) a container inside the interacted control's own ancestry, the
// distance resolveControlAt already walks, which is the answer arriving where the person was
// looking. Text added anywhere else is a re-render, not an answer, and is not a beat.
type Tier = "announced" | "in_place";

type Announcement = "error" | "message";

type Interaction = {
  readonly containers: ReadonlySet<number>;
};

type AddedRoot = {
  readonly parentId: number;
  readonly node: UnknownRecord;
};

type Candidate = {
  readonly atMs: number;
  readonly order: number;
  readonly containerId: number;
  readonly tier: Tier;
  readonly reaction: ReactionKind;
  readonly text: string | null;
};

type Spoken = {
  readonly parts: readonly string[];

  readonly masked: boolean;
};

const NOTHING_SPOKEN: Spoken = { parts: [], masked: false };

// Unlike an accessible name, a masked run here is reported rather than skipped: a container that
// said something the recorder withheld has to stay a beat, or it reads as a screen that was silent.
function spokenText(node: UnknownRecord, depth: number): Spoken {
  if (isUnnamed(node)) return NOTHING_SPOKEN;

  if (node["type"] === RRWEB_NODE_TYPE.text) {
    const content = node["textContent"];
    if (typeof content !== "string" || content.trim().length === 0) return NOTHING_SPOKEN;

    return isMaskedText(content)
      ? { parts: [], masked: true }
      : { parts: [content], masked: false };
  }

  const children = node["childNodes"];
  if (depth >= MAX_ANCESTOR_WALK || !Array.isArray(children)) return NOTHING_SPOKEN;

  const parts: string[] = [];
  let masked = false;

  for (const child of children) {
    const record = asRecord(child);
    if (record === null) continue;

    const spoken = spokenText(record, depth + 1);
    parts.push(...spoken.parts);
    masked = masked || spoken.masked;
  }

  return { parts, masked };
}

function announcementIn(attributes: Readonly<Record<string, unknown>>): Announcement | null {
  if (attributes[ROLE_ATTRIBUTE] === ALERT_ROLE_VALUE) return "error";
  if (attributes[ARIA_ERROR_MESSAGE_ATTRIBUTE] !== undefined) return "error";
  return attributes[ARIA_LIVE_ATTRIBUTE] === undefined ? null : "message";
}

function announcementOf(node: UnknownRecord, depth: number): Announcement | null {
  const attributes = asRecord(node["attributes"]);
  const own = attributes === null ? null : announcementIn(attributes);
  if (own === "error") return own;

  const children = node["childNodes"];
  if (depth >= MAX_ANCESTOR_WALK || !Array.isArray(children)) return own;

  let found = own;
  for (const child of children) {
    const record = asRecord(child);
    if (record === null) continue;

    const nested = announcementOf(record, depth + 1);
    if (nested === "error") return nested;
    found = found ?? nested;
  }
  return found;
}

// A recording is untrusted input, so the walk is capped the same way collectTree's is.
function addedIds(adds: readonly MutationAdd[]): ReadonlySet<number> {
  const ids = new Set<number>();
  const pending: UnknownRecord[] = adds.map((add) => add.node);
  let visited = 0;

  while (pending.length > 0 && visited < MAX_INDEXED_NODES) {
    const node = pending.pop();
    if (node === undefined) break;
    visited += 1;

    const id = node["id"];
    if (typeof id === "number") ids.add(id);

    const children = node["childNodes"];
    if (!Array.isArray(children)) continue;
    for (const child of children) {
      const record = asRecord(child);
      if (record !== null) pending.push(record);
    }
  }

  return ids;
}

// rrweb emits one add per node with its parent's id, so an added subtree arrives flat and has to
// be reassembled before anything can read the words it renders.
function rootsOf(adds: readonly MutationAdd[]): readonly AddedRoot[] {
  const added = addedIds(adds);
  const assembled = new Map<number, Record<string, unknown>>();
  const built: { readonly node: Record<string, unknown>; readonly parentId: number | null }[] = [];

  for (const add of adds) {
    const children = add.node["childNodes"];
    const node: Record<string, unknown> = {
      ...add.node,
      childNodes: Array.isArray(children) ? [...children] : [],
    };

    const id = add.node["id"];
    if (typeof id === "number") assembled.set(id, node);
    built.push({ node, parentId: add.parentId });
  }

  const roots: AddedRoot[] = [];
  for (const entry of built) {
    const parentId = entry.parentId;
    if (parentId === null) continue;

    if (!added.has(parentId)) {
      roots.push({ parentId, node: entry.node });
      continue;
    }

    const parent = assembled.get(parentId);
    if (parent === undefined) continue;
    (parent["childNodes"] as unknown[]).push(entry.node);
  }

  return roots;
}

function candidateOf(
  root: AddedRoot,
  segment: DomSegment,
  interaction: Interaction,
  replaced: ReadonlySet<number>,
  atMs: number,
  order: number,
): Candidate | null {
  if (replaced.has(root.parentId)) return null;

  const container = segment.index.get(root.parentId);
  if (container === undefined || !isRenderedContainer(container)) return null;

  const spoken = spokenText(root.node, 0);
  if (spoken.parts.length === 0 && !spoken.masked) return null;

  const announcement = announcementIn(container.attributes) ?? announcementOf(root.node, 0);
  const beside =
    interaction.containers.has(root.parentId) && !PAGE_ROOT_TAG_NAMES.includes(container.tagName);

  const tier: Tier | null = announcement !== null ? "announced" : beside ? "in_place" : null;
  if (tier === null) return null;

  return {
    atMs,
    order,
    containerId: root.parentId,
    tier,
    reaction: announcement === "error" ? "error" : "message",
    text: spoken.masked ? null : deliverableSentence(spoken.parts.join(" ")),
  };
}

function containersOf(segment: DomSegment, nodeId: number): ReadonlySet<number> {
  const containers = new Set<number>([nodeId]);
  let current = nodeId;

  for (let step = 0; step < MAX_ANCESTOR_WALK; step += 1) {
    const parentId = segment.parents.get(current);
    if (parentId === undefined) break;

    containers.add(parentId);
    current = parentId;
  }

  return containers;
}

function interactionAt(fact: ReplayFact, segments: DomSegments): Interaction | null {
  const segment = segmentAt(segments, fact.tsMs);
  if (segment === null) return null;

  if (fact.kind === "mouse") {
    const clicked =
      fact.interaction === RRWEB_MOUSE_INTERACTION.click ||
      fact.interaction === RRWEB_MOUSE_INTERACTION.doubleClick;
    if (!clicked) return null;

    const element = resolveControlAt(segments, fact.nodeId, fact.tsMs);
    return { containers: containersOf(segment, element.nodeId) };
  }

  if (fact.kind !== "input") return null;

  const element = resolveIdentityAt(segments, fact.nodeId, fact.tsMs);
  return { containers: containersOf(segment, element.nodeId) };
}

// One beat per container, and one per distinct thing said: a component that re-renders the same
// answer into the same place a dozen times still only answered once.
function draftsFrom(candidates: readonly Candidate[], firstTsMs: number): readonly ReactionDraft[] {
  const announced = candidates.filter((candidate) => candidate.tier === "announced");
  const chosen = announced.length > 0 ? announced : candidates;

  const containers = new Set<number>();
  const said = new Set<string>();
  const drafts: ReactionDraft[] = [];

  for (const candidate of chosen) {
    if (containers.has(candidate.containerId)) continue;
    containers.add(candidate.containerId);

    const phrase = candidate.text ?? `withheld ${candidate.reaction}`;
    if (said.has(phrase)) continue;
    said.add(phrase);

    const atMs = candidate.atMs - firstTsMs;
    drafts.push({
      atMs,
      order: candidate.order,
      action: {
        kind: "reaction",
        atMs,
        reaction: candidate.reaction,
        ...(candidate.text === null ? {} : { text: candidate.text }),
      },
    });
  }

  return drafts;
}

export function reactionDrafts(
  facts: readonly ReplayFact[],
  segments: DomSegments,
  firstTsMs: number,
): readonly ReactionDraft[] {
  const drafts: ReactionDraft[] = [];
  let open: Interaction | null = null;
  let pending: Candidate[] = [];

  for (const [order, fact] of facts.entries()) {
    // A snapshot renumbers the whole tree, so the ids an open interaction was holding name
    // different elements from here on and attribution across the seam would be invented.
    if (fact.kind === "snapshot") {
      drafts.push(...draftsFrom(pending, firstTsMs));
      pending = [];
      open = null;
      continue;
    }

    const started = interactionAt(fact, segments);
    if (started !== null) {
      drafts.push(...draftsFrom(pending, firstTsMs));
      pending = [];
      open = started;
      continue;
    }

    if (fact.kind !== "mutation" || open === null) continue;

    const segment = segmentAt(segments, fact.tsMs);
    if (segment === null) continue;

    const replaced = new Set(fact.removedParentIds);
    for (const root of rootsOf(fact.adds)) {
      const candidate = candidateOf(root, segment, open, replaced, fact.tsMs, order);
      if (candidate !== null) pending.push(candidate);
    }
  }

  drafts.push(...draftsFrom(pending, firstTsMs));
  return drafts;
}
