export type ElementIdentity = {
  readonly nodeId: number;
  readonly tagName: string;
  readonly id?: string;
  readonly classes: readonly string[];
  readonly role?: string;
  readonly testId?: string;

  // What a person would call this control, taken from developer-authored text bound to it and
  // held to the same one clean token an attribute value is (B-052). No element key reads it.
  readonly accessibleName?: string;

  readonly attributes: Readonly<Record<string, string>>;
};

export type PageAction = {
  readonly kind: "page";
  readonly atMs: number;
  readonly href: string;
};

export type ClickAction = {
  readonly kind: "click";
  readonly atMs: number;
  readonly element: ElementIdentity;
};

export type DoubleClickAction = {
  readonly kind: "double_click";
  readonly atMs: number;
  readonly element: ElementIdentity;
};

export type RageClickAction = {
  readonly kind: "rage_click";
  readonly atMs: number;
  readonly element: ElementIdentity;
  readonly clicks: number;
  readonly spanMs: number;
};

export type DeadClickAction = {
  readonly kind: "dead_click";
  readonly atMs: number;
  readonly element: ElementIdentity;
};

export type InputAction = {
  readonly kind: "input";
  readonly atMs: number;
  readonly element: ElementIdentity;
};

export type FieldRefocusAction = {
  readonly kind: "field_refocus";
  readonly atMs: number;
  readonly element: ElementIdentity;
  readonly focusCount: number;
};

export type FieldAbandonedAction = {
  readonly kind: "field_abandoned";
  readonly atMs: number;
  readonly element: ElementIdentity;
};

export type ScrollBackAction = {
  readonly kind: "scroll_back";
  readonly atMs: number;
  readonly element: ElementIdentity;
};

export type WaitAction = {
  readonly kind: "wait";
  readonly atMs: number;
  readonly durationMs: number;
};

export type EndedAction = {
  readonly kind: "ended";
  readonly atMs: number;
};

export type SessionAction =
  | PageAction
  | ClickAction
  | DoubleClickAction
  | RageClickAction
  | DeadClickAction
  | InputAction
  | FieldRefocusAction
  | FieldAbandonedAction
  | ScrollBackAction
  | WaitAction
  | EndedAction;

export type SessionActionKind = SessionAction["kind"];

export type TranscriptCounts = {
  readonly clicks: number;
  readonly deadClicks: number;
  readonly rageClicks: number;
  readonly refocuses: number;
  readonly abandonedFields: number;
  readonly scrollBacks: number;
};

export type SessionTranscript = {
  readonly actions: readonly SessionAction[];

  readonly startedAt: Date | null;

  // The instant `atMs` counts from. A later pull of the same recording is stamped against it,
  // so the two halves share one clock.
  readonly clockOriginAtMs: number | null;
  readonly durationMs: number;
  readonly pages: readonly string[];
  readonly counts: TranscriptCounts;

  readonly droppedEvents: number;
};
