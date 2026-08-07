// The vocabulary the filter engine is allowed to know. Everything that identifies a particular
// filter — its param, its words, its option values — arrives as data in a descriptor, so adding a
// filter is adding a descriptor rather than editing the engine.

export type FilterKind = "list" | "segment";

export interface FilterOption {
  readonly value: string;
  readonly label: string;
  readonly description: string | null;

  // Null means the read that would have counted this option did not answer. A missing count is
  // not a zero count, and the panel says nothing rather than saying nothing is there.
  readonly sessionCount: number | null;
  readonly replayCount: number | null;
}

export interface FilterDescriptor {
  readonly param: string;
  readonly restLabel: string;
  readonly kind: FilterKind;

  // The panel's morph target, in px. The engine reads it; it never branches on which descriptor
  // is open.
  readonly panelSize: readonly [number, number];

  readonly searchPlaceholder: string | null;
  readonly footNote: string | null;

  // Data, never a predicate: the counts were conditioned on the server, and the client never
  // filters sessions.
  readonly options: readonly FilterOption[];

  readonly value: string | null;

  // The applied pill's accessible name, and — called with no value — the axis name the panel
  // heads itself with.
  readonly summarise: (value: string) => string;

  readonly clearLabel: string;
}
