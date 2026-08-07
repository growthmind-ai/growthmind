"use client";

import { Box, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useState } from "react";

import { normaliseUrlPath } from "@growthmind/shared";

import { Eyebrow } from "@/components/ui/Eyebrow";
import { AnchorLink } from "@/components/ui/Links";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import { ROUTES } from "@/lib/routes";

import classes from "./receipts.module.css";
import {
  chipLabel,
  countReceipt,
  DATA_GROUPS,
  everythingSetAsideNote,
  EVERYTHING_SET_ASIDE_ACTION,
  mixedVersionNote,
  NO_COUNTS_NOTE,
  NOTHING_SEEN_ACTION,
  NOTHING_SEEN_NOTE,
  NOTHING_SEEN_RECEIPT,
  unclaimedSetAside,
  type CountRow,
  type CountsView,
  type Receipt,
  type Statement,
  type StatementGroup,
} from "./statements";

// The examples the address rule is run over, live, in the reader's own browser. The last is
// deliberately unchanged: a rule that only ever demonstrates itself redacting looks like it
// redacts everything.
const ADDRESS_EXAMPLES: readonly string[] = [
  "/orders/7f3a9c2e-11b4-4f0a-9d2e-6b8c1a5f0d33/receipt?token=s3cr3t",
  "/u/alice@acme.com/settings#billing",
  "/invoices/000184320/pay",
  "/pricing",
];

// A class rather than a `data-` attribute: nothing about the open state belongs in an
// attribute rrweb cannot mask, and the exposure register counts every such binding.
function openClass(base: string, open: boolean): string {
  return open ? `${base} ${classes.open}` : base;
}

function Mono({ children, strong }: { readonly children: string; readonly strong?: boolean }) {
  return (
    <Text span ff="monospace" size="xs" fw={strong === true ? 700 : 400}>
      {children}
    </Text>
  );
}

function CountRows({
  rows,
  totalLabel,
  subtotal,
  total,
}: {
  readonly rows: readonly CountRow[];
  readonly totalLabel: string;
  readonly subtotal: number;
  readonly total: number;
}) {
  return (
    <Stack gap={0}>
      {rows.map((row) => (
        <Group key={row.label} justify="space-between" gap="md" py={4} className={classes.row}>
          <Text size="sm">{row.label}</Text>
          <Text size="sm" ff="monospace" fw={700}>
            {row.count}
          </Text>
        </Group>
      ))}
      <Group justify="space-between" gap="md" py={4} className={classes.row}>
        <Text size="sm" fw={700}>
          {totalLabel}
        </Text>
        <Text size="sm" ff="monospace" fw={700}>
          {subtotal} of {total}
        </Text>
      </Group>
    </Stack>
  );
}

function TransformBody() {
  const [typed, setTyped] = useState("");
  const tried = typed.trim().length === 0 ? null : normaliseUrlPath(typed, null);

  return (
    <Stack gap={4}>
      {ADDRESS_EXAMPLES.map((example) => (
        <Text key={example} size="xs" style={{ wordBreak: "break-all" }}>
          <Mono>{example}</Mono>
          {" → "}
          <Mono strong>{normaliseUrlPath(example, null) ?? "—"}</Mono>
        </Text>
      ))}
      <TextInput
        mt={4}
        size="xs"
        label="Paste one of your own addresses to see what we would store"
        placeholder="/orders/12345/receipt?token=…"
        value={typed}
        onChange={(event) => {
          setTyped(event.currentTarget.value);
        }}
      />
      {tried === null ? null : (
        <Text size="xs" style={{ wordBreak: "break-all" }}>
          {"→ "}
          <Mono strong>{tried}</Mono>
        </Text>
      )}
      <Text size="xs" c="dimmed">
        This runs in your browser. Nothing you type here is sent to us or stored.
      </Text>
    </Stack>
  );
}

function ReceiptBody({
  receipt,
  counts,
}: {
  readonly receipt: Receipt;
  readonly counts: CountsView | null;
}) {
  if (receipt.kind === "transform") return <TransformBody />;
  if (counts === null) return null;

  if (counts.total === 0) {
    return <Text size="sm">{NOTHING_SEEN_RECEIPT}</Text>;
  }

  const view = countReceipt(counts, receipt);
  if (view === null) return null;

  const note = mixedVersionNote(counts);

  return (
    <Stack gap={6}>
      <CountRows
        rows={view.rows}
        totalLabel={view.totalLabel}
        subtotal={view.subtotal}
        total={view.total}
      />
      {note === null ? null : (
        <Text size="xs" c="dimmed">
          {note}
        </Text>
      )}
    </Stack>
  );
}

function StatementBlock({
  statement,
  counts,
  open,
  onToggle,
}: {
  readonly statement: Statement;
  readonly counts: CountsView | null;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const receipt = statement.receipt;

  // One predicate, two reasons: no producer at all, or a count we could not read. Never a
  // disabled chip — a control that advertises a capability and then refuses it reads worse
  // than no control.
  const hasChip = receipt !== undefined && (receipt.kind === "transform" || counts !== null);
  const regionId = `receipt-${statement.id}`;

  return (
    <Stack gap={6}>
      <Text size="sm">{statement.text}</Text>

      {receipt !== undefined && counts === null && receipt.kind !== "transform" ? (
        <Text size="xs" c="dimmed">
          {NO_COUNTS_NOTE}
        </Text>
      ) : null}

      {hasChip && receipt !== undefined ? (
        <>
          <Box>
            <Button
              type="button"
              variant="default"
              size="compact-sm"
              radius="xl"
              aria-expanded={open}
              aria-controls={regionId}
              onClick={onToggle}
              className={classes.chip}
            >
              {chipLabel(counts, receipt)}
              <Text span ml={6} className={openClass(classes.chevron, open)} aria-hidden>
                ▾
              </Text>
            </Button>
          </Box>
          <div id={regionId} className={openClass(classes.disclosure, open)}>
            <div className={classes.disclosureInner}>
              <Box pt={6}>
                <ReceiptBody receipt={receipt} counts={counts} />
              </Box>
            </div>
          </div>
        </>
      ) : null}
    </Stack>
  );
}

function GroupCard({
  group,
  counts,
  open,
  onToggle,
}: {
  readonly group: StatementGroup;
  readonly counts: CountsView | null;
  readonly open: Readonly<Record<string, boolean>>;
  readonly onToggle: (id: string) => void;
}) {
  const leftover = counts === null || group.id !== "set-aside" ? [] : unclaimedSetAside(counts);

  return (
    <SurfaceCard>
      <Group justify="space-between" gap="md" wrap="wrap" mb={8}>
        <Eyebrow>{group.label}</Eyebrow>
        {group.stamp === undefined ? null : (
          <Text size="xs" ff="monospace" c="dimmed">
            {group.stamp}
          </Text>
        )}
      </Group>

      <Stack gap="sm">
        {group.statements.map((statement) => (
          <StatementBlock
            key={statement.id}
            statement={statement}
            counts={counts}
            open={open[statement.id] === true}
            onToggle={() => {
              onToggle(statement.id);
            }}
          />
        ))}

        {leftover.length === 0 || counts === null ? null : (
          <Stack gap={4}>
            <Text size="sm">
              Set aside by a rule this page does not yet describe. It is shown so the numbers above
              still add up to everything we have seen.
            </Text>
            {leftover.map((row) => (
              <Text key={row.label} size="xs" c="dimmed">
                {row.label} — {row.count} of {counts.total} sessions
              </Text>
            ))}
          </Stack>
        )}
      </Stack>
    </SurfaceCard>
  );
}

export function DataGroups({ counts }: { readonly counts: CountsView | null }) {
  // Opening one receipt never closes another, and nothing outside a chip closes anything.
  // A reader who opened four to read the page as one artifact must not lose them by clicking
  // the margin, which is why no click-away or Escape handler exists here.
  const [open, setOpen] = useState<Readonly<Record<string, boolean>>>({});

  const toggle = (id: string): void => {
    setOpen((current) => ({ ...current, [id]: current[id] !== true }));
  };

  const alarm = counts === null ? null : everythingSetAsideNote(counts);

  return (
    <Stack gap="sm">
      {alarm === null ? null : (
        <SurfaceCard tone="accent">
          <Stack gap={6} align="flex-start">
            <Text size="sm">{alarm}</Text>
            <AnchorLink href={ROUTES.settings} size="sm">
              {EVERYTHING_SET_ASIDE_ACTION}
            </AnchorLink>
          </Stack>
        </SurfaceCard>
      )}

      {counts !== null && counts.total === 0 ? (
        <SurfaceCard tone="accent">
          <Stack gap={6} align="flex-start">
            <Text size="sm">{NOTHING_SEEN_NOTE}</Text>
            <AnchorLink href={ROUTES.settings} size="sm">
              {NOTHING_SEEN_ACTION}
            </AnchorLink>
          </Stack>
        </SurfaceCard>
      ) : null}

      {DATA_GROUPS.map((group) => (
        <GroupCard key={group.id} group={group} counts={counts} open={open} onToggle={toggle} />
      ))}
    </Stack>
  );
}
