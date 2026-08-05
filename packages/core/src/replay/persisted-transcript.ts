import { z } from "zod";

import type { ElementIdentity, SessionAction, SessionActionKind } from "./types";

export const PERSISTED_TRANSCRIPT_VERSION = 1;

export const PERSISTED_TRANSCRIPT_MAX_CLASSES = 8;

export type PersistedElement = {
  readonly nodeId: number;
  readonly tag: string;
  readonly id?: string;
  readonly testId?: string;
  readonly role?: string;
  readonly classes: readonly string[];
};

export type PersistedSessionAction = {
  readonly kind: SessionActionKind;
  readonly atMs: number;
  readonly element?: PersistedElement;
  readonly href?: string;
  readonly clicks?: number;
  readonly spanMs?: number;
  readonly focusCount?: number;
  readonly durationMs?: number;
};

export type PersistedTranscript = {
  readonly v: number;
  readonly actions: readonly PersistedSessionAction[];
};

export type PersistedTranscriptSerialiser = (
  actions: readonly SessionAction[],
) => PersistedTranscript;

type ElementFields = {
  readonly nodeId: number;
  readonly tag: string;
  readonly classes: readonly string[];
  readonly id?: string | undefined;
  readonly role?: string | undefined;
  readonly testId?: string | undefined;
};

type ActionFields = {
  readonly kind: SessionActionKind;
  readonly atMs: number;
  readonly element?: ElementFields | undefined;
  readonly href?: string | undefined;
  readonly clicks?: number | undefined;
  readonly spanMs?: number | undefined;
  readonly focusCount?: number | undefined;
  readonly durationMs?: number | undefined;
};

// Both directions build through these two, so an absent field is an absent key rather than an
// explicit undefined — which canonicalJson refuses, and a citation's identity rests on it.
function persistedElement(fields: ElementFields): PersistedElement {
  return {
    nodeId: fields.nodeId,
    tag: fields.tag,
    classes: fields.classes.slice(0, PERSISTED_TRANSCRIPT_MAX_CLASSES),
    ...(fields.id === undefined ? {} : { id: fields.id }),
    ...(fields.role === undefined ? {} : { role: fields.role }),
    ...(fields.testId === undefined ? {} : { testId: fields.testId }),
  };
}

function persistedAction(fields: ActionFields): PersistedSessionAction {
  return {
    kind: fields.kind,
    atMs: fields.atMs,
    ...(fields.element === undefined ? {} : { element: persistedElement(fields.element) }),
    ...(fields.href === undefined ? {} : { href: fields.href }),
    ...(fields.clicks === undefined ? {} : { clicks: fields.clicks }),
    ...(fields.spanMs === undefined ? {} : { spanMs: fields.spanMs }),
    ...(fields.focusCount === undefined ? {} : { focusCount: fields.focusCount }),
    ...(fields.durationMs === undefined ? {} : { durationMs: fields.durationMs }),
  };
}

// ElementIdentity.attributes is never carried across: an open map copied off a live DOM can hold
// an email address, a title, or a URL with a token in it (ADD §1.4).
function fieldsOf(element: ElementIdentity): ElementFields {
  return {
    nodeId: element.nodeId,
    tag: element.tagName,
    classes: element.classes,
    id: element.id,
    role: element.role,
    testId: element.testId,
  };
}

function refuseKindUnknownToV1(action: never): never {
  const { kind } = action as SessionAction;

  throw new Error(
    `serialisePersistedTranscript has no version 1 shape for the action kind ${kind}: version 1 ` +
      `may not guess a shape for a kind added after it was written. Register a v2 serialiser and ` +
      `write new rows with it.`,
  );
}

function serialiseActionV1(action: SessionAction): PersistedSessionAction {
  const kind = action.kind;
  const atMs = Math.round(action.atMs);

  switch (action.kind) {
    case "page":
      return persistedAction({ kind, atMs, href: action.href });
    case "click":
    case "double_click":
    case "dead_click":
    case "input":
    case "field_abandoned":
    case "scroll_back":
      return persistedAction({ kind, atMs, element: fieldsOf(action.element) });
    case "rage_click":
      return persistedAction({
        kind,
        atMs,
        element: fieldsOf(action.element),
        clicks: action.clicks,
        spanMs: action.spanMs,
      });
    case "field_refocus":
      return persistedAction({
        kind,
        atMs,
        element: fieldsOf(action.element),
        focusCount: action.focusCount,
      });
    case "wait":
      return persistedAction({ kind, atMs, durationMs: action.durationMs });
    case "ended":
      return persistedAction({ kind, atMs });
    default:
      return refuseKindUnknownToV1(action);
  }
}

function serialiseV1(actions: readonly SessionAction[]): PersistedTranscript {
  return { v: 1, actions: actions.map((action) => serialiseActionV1(action)) };
}

export const PERSISTED_TRANSCRIPT_SERIALISERS: ReadonlyMap<number, PersistedTranscriptSerialiser> =
  new Map([[1, serialiseV1]]);

export function serialisePersistedTranscript(
  actions: readonly SessionAction[],
  version: number,
): PersistedTranscript {
  const serialiser = PERSISTED_TRANSCRIPT_SERIALISERS.get(version);
  if (serialiser === undefined) {
    throw new Error(
      `serialisePersistedTranscript has no serialiser registered for version ${String(version)}: ` +
        `a transcript can only be written by the version that stamps it. Falling back to version ` +
        `${String(PERSISTED_TRANSCRIPT_VERSION)} would mint one shape for a row claiming another ` +
        `and detach every citation resting on it.`,
    );
  }

  return serialiser(actions);
}

const V1_ACTION_KINDS = [
  "page",
  "click",
  "double_click",
  "rage_click",
  "dead_click",
  "input",
  "field_refocus",
  "field_abandoned",
  "scroll_back",
  "wait",
  "ended",
] as const satisfies readonly SessionActionKind[];

const persistedElementSchemaV1 = z.object({
  nodeId: z.number().int(),
  tag: z.string(),
  id: z.string().optional(),
  testId: z.string().optional(),
  role: z.string().optional(),
  classes: z.array(z.string()),
});

const persistedActionSchemaV1 = z.object({
  kind: z.enum(V1_ACTION_KINDS),
  atMs: z.number().int(),
  element: persistedElementSchemaV1.optional(),
  href: z.string().optional(),
  clicks: z.number().int().optional(),
  spanMs: z.number().int().optional(),
  focusCount: z.number().int().optional(),
  durationMs: z.number().int().optional(),
});

const persistedTranscriptSchemaV1 = z.object({
  v: z.literal(1),
  actions: z.array(persistedActionSchemaV1),
});

const storedVersionSchema = z.object({ v: z.number().int() });

type PersistedTranscriptReader = (value: unknown) => PersistedTranscript | null;

function readV1(value: unknown): PersistedTranscript | null {
  const parsed = persistedTranscriptSchemaV1.safeParse(value);
  if (!parsed.success) return null;

  return {
    v: parsed.data.v,
    actions: parsed.data.actions.map((action) => persistedAction(action)),
  };
}

const PERSISTED_TRANSCRIPT_READERS: ReadonlyMap<number, PersistedTranscriptReader> = new Map([
  [1, readV1],
]);

export function readPersistedTranscript(value: unknown): PersistedTranscript | null {
  const stored = storedVersionSchema.safeParse(value);
  if (!stored.success) return null;

  const reader = PERSISTED_TRANSCRIPT_READERS.get(stored.data.v);
  return reader === undefined ? null : reader(value);
}
