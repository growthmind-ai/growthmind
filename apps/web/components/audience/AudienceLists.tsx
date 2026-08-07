"use client";

import { Stack } from "@mantine/core";
import { useState, type ReactNode } from "react";

import type { BeliefCardView, FactRowView } from "@/lib/audience/read";

import { BeliefCard, DroppedBeliefCard } from "./BeliefCard";
import { DroppedFactRow, FactRow } from "./FactRow";

// A dropped statement is gone from the server's next read, so the object that showed it
// cannot be the one that offers Undo: the drop's own push re-renders this page about a
// quarter of a second later, and the Undo went with the unmounted card. The list outlives
// that round trip and holds the tombstone until the person acts on it.
interface Tombstone<V> {
  readonly view: V;
  readonly id: string;

  // The seat it was dropped from, so Undo does not jump to the end of the list when the
  // server stops sending the row.
  readonly seat: number;
}

type Entry<V> =
  | { readonly kind: "live"; readonly key: string; readonly view: V }
  | { readonly kind: "dropped"; readonly key: string; readonly tomb: Tombstone<V> };

interface Statement {
  readonly factKind: string;
  readonly claim: string;
}

function idOf(view: Statement): string {
  return `${view.factKind}:${view.claim}`;
}

// Keyed on the kind and the seat, never on the claim: a correction rewrites the claim, and
// a key that moved with it remounted the card mid-tick — resetting the surface to rest and
// emptying the live region before the confirmation could be read out.
function keyOf(view: Statement, at: number): string {
  return `${view.factKind}:${at}`;
}

function merged<V extends Statement>(
  views: readonly V[],
  tombs: readonly Tombstone<V>[],
): readonly Entry<V>[] {
  const byId = new Map(tombs.map((tomb) => [tomb.id, tomb]));
  const placed = new Set<string>();
  const entries: Entry<V>[] = [];

  views.forEach((view, at) => {
    const tomb = byId.get(idOf(view));

    if (tomb === undefined) {
      entries.push({ kind: "live", key: keyOf(view, at), view });
      return;
    }

    placed.add(tomb.id);
    entries.push({ kind: "dropped", key: `dropped:${tomb.id}`, tomb });
  });

  for (const tomb of tombs.filter((entry) => !placed.has(entry.id))) {
    entries.splice(Math.min(tomb.seat, entries.length), 0, {
      kind: "dropped",
      key: `dropped:${tomb.id}`,
      tomb,
    });
  }

  return entries;
}

function useTombstones<V extends Statement>(views: readonly V[]) {
  const [tombs, setTombs] = useState<readonly Tombstone<V>[]>([]);

  return {
    entries: merged(views, tombs),
    drop: (view: V, seat: number) =>
      setTombs((current) =>
        current.some((tomb) => tomb.id === idOf(view))
          ? current
          : [...current, { view, id: idOf(view), seat }],
      ),
    forget: (id: string) => setTombs((current) => current.filter((tomb) => tomb.id !== id)),
  };
}

interface ListProps<V> {
  readonly views: readonly V[];

  // Rendered by the server component, so the section title stays a literal there rather
  // than an interpolated `title` prop the replay-attribute register would have to carry.
  readonly heading: ReactNode;

  readonly rowClassName: string;
  readonly stepMs: number;
}

// The heading lives inside the list rather than beside it: dropping the last belief empties
// the server's `cards`, and a heading gated on that would take the tombstone with it.
export function BeliefCardList({
  views,
  heading,
  rowClassName,
  stepMs,
}: ListProps<BeliefCardView>) {
  const { entries, drop, forget } = useTombstones(views);

  if (entries.length === 0) return null;

  return (
    <>
      {heading}
      <Stack gap="sm">
        {entries.map((entry, at) => (
          <div
            key={entry.key}
            className={rowClassName}
            style={{ animationDelay: `${at * stepMs}ms` }}
          >
            {entry.kind === "live" ? (
              <BeliefCard card={entry.view} onDropped={() => drop(entry.view, at)} />
            ) : (
              <DroppedBeliefCard
                card={entry.tomb.view}
                onRestored={() => forget(entry.tomb.id)}
                onDismiss={() => forget(entry.tomb.id)}
              />
            )}
          </div>
        ))}
      </Stack>
    </>
  );
}

export function FactRowList({ views, heading, rowClassName, stepMs }: ListProps<FactRowView>) {
  const { entries, drop, forget } = useTombstones(views);

  if (entries.length === 0) return null;

  return (
    <>
      {heading}
      <Stack gap={0}>
        {entries.map((entry, at) => (
          <div
            key={entry.key}
            className={rowClassName}
            style={{ animationDelay: `${at * stepMs}ms` }}
          >
            {entry.kind === "live" ? (
              <FactRow view={entry.view} onDropped={() => drop(entry.view, at)} />
            ) : (
              <DroppedFactRow
                view={entry.tomb.view}
                onRestored={() => forget(entry.tomb.id)}
                onDismiss={() => forget(entry.tomb.id)}
              />
            )}
          </div>
        ))}
      </Stack>
    </>
  );
}
