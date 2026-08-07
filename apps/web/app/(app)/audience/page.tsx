import { Stack, Text } from "@mantine/core";

import { createGrowthContextRepo, ensureProject } from "@growthmind/db";
import type { LiveTopic } from "@growthmind/shared";

import {
  AudienceEmpty,
  AudienceReadFailed,
  AudienceReading,
  AudienceResearchFailed,
} from "@/components/audience/AudienceStates";
import { BeliefCard } from "@/components/audience/BeliefCard";
import { DoubtRow } from "@/components/audience/DoubtRow";
import { FactRow } from "@/components/audience/FactRow";
import { LiveRefresh } from "@/components/live/LiveRefresh";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { ClosingNote, PageHeader, SectionHeading } from "@/components/ui/Page";
import { SurfaceCard } from "@/components/ui/SurfaceCard";
import {
  AUDIENCE_AFFORDANCE,
  AUDIENCE_LEDE,
  CLOSING_NOTE,
  buildAudienceView,
  type AudienceDoubtView,
  type AudienceView,
  type ChangedSectionView,
  type PopulatedAudienceView,
  type ProvenanceStripView,
} from "@/lib/audience/read";
import { getDb } from "@/lib/db";
import { tryRead } from "@/lib/read-or-fallback";
import { requireTenantContext } from "@/lib/tenant";

import classes from "./audience.module.css";

export const dynamic = "force-dynamic";

// Typed against the live-topic union, so a reworded topic is a compile error here rather
// than a page that quietly stops hearing (D9).
const AUDIENCE_TOPICS = ["business_context"] as const satisfies readonly LiveTopic[];

const CASCADE_STEP_MS = 40;

export default async function AudiencePage() {
  const ctx = await requireTenantContext();

  const db = getDb();
  const { projectId } = await ensureProject(db, ctx);

  // A failed read renders its own state, never the empty one: `null` is also the shape of
  // a healthy workspace with no website named, and the two must not share a sentence.
  const read = await tryRead(
    () => createGrowthContextRepo(db, ctx).readBusinessResearch(projectId),
    "audience: the model behind this page could not be read",
    { organizationId: ctx.organizationId, projectId },
  );

  return (
    <Stack gap="lg">
      {/* Mounted in every state: the empty page fills in place the moment the first read
          lands, and the populated one re-renders when anyone in the org writes. */}
      <LiveRefresh topics={AUDIENCE_TOPICS} />

      {/* Section titles are literals rather than the view-model's constants: the replay
          attribute register counts interpolated title props, and a literal is provably our
          copy without an entry there. */}
      <PageHeader title="Who we think this is for">{AUDIENCE_LEDE}</PageHeader>

      {read.ok ? (
        <AudienceBody view={buildAudienceView(read.value, { userId: ctx.userId }, new Date())} />
      ) : (
        <AudienceReadFailed />
      )}
    </Stack>
  );
}

function AudienceBody({ view }: { readonly view: AudienceView }) {
  switch (view.kind) {
    case "no-website":
      return <AudienceEmpty view={view} />;
    case "reading":
      return <AudienceReading view={view} />;
    case "read-failed-research":
      return <AudienceResearchFailed view={view} />;
    case "populated":
      return <PopulatedAudience view={view} />;
  }
}

function PopulatedAudience({ view }: { readonly view: PopulatedAudienceView }) {
  return (
    <>
      {/* The verbs only appear on hover, focus or a tap, so the page says so before the
          first belief rather than leaving a reader to discover it by accident. */}
      <Text size="sm">{AUDIENCE_AFFORDANCE}</Text>

      <ProvenanceStrip strip={view.strip} />

      {view.thinNote === null ? null : (
        <Text size="sm" c="dimmed">
          {view.thinNote}
        </Text>
      )}

      {view.cards.length === 0 ? null : (
        <>
          <SectionHeading title="What we believe about them" />
          <Stack gap="sm">
            {view.cards.map((card, index) => (
              <div
                key={`${card.factKind}:${card.claim}`}
                className={classes.rowIn}
                style={{ animationDelay: `${index * CASCADE_STEP_MS}ms` }}
              >
                <BeliefCard card={card} />
              </div>
            ))}
          </Stack>
        </>
      )}

      {view.rows.length === 0 ? null : (
        <>
          <SectionHeading title="How they decide, and what they arrive with" />
          <Stack gap={0}>
            {view.rows.map((row, index) => (
              <div
                key={`${row.factKind}:${row.claim}`}
                className={classes.rowIn}
                style={{ animationDelay: `${index * CASCADE_STEP_MS}ms` }}
              >
                <FactRow view={row} />
              </div>
            ))}
          </Stack>
        </>
      )}

      {view.latestCorrection === null ? null : <ChangedSection changed={view.latestCorrection} />}

      {view.doubts.length === 0 ? null : (
        <>
          {/* Not "one tap settles it": answering one costs a reveal, the verb and the
              option, and a heading may not promise a path the page does not have. */}
          <SectionHeading title="What we are least sure about — we can settle it in one answer" />
          <Stack gap="sm">
            {view.doubts.map((doubt) => (
              <DoubtRow key={doubtKey(doubt)} doubt={doubt} />
            ))}
          </Stack>
        </>
      )}

      <ClosingNote>{CLOSING_NOTE}</ClosingNote>
    </>
  );
}

function ProvenanceStrip({ strip }: { readonly strip: ProvenanceStripView }) {
  return (
    <SurfaceCard>
      <Stack gap="xs">
        <StripCell label="Built from">{strip.builtFrom}</StripCell>
        <StripCell label="What it's built on">{strip.builtOn}</StripCell>
        <StripCell label="Last changed">{strip.lastChanged}</StripCell>
      </Stack>
    </SurfaceCard>
  );
}

function StripCell({ label, children }: { readonly label: string; readonly children: string }) {
  return (
    <Text size="sm">
      <Text span fw={700} inherit>
        {label}:{" "}
      </Text>
      {children}
    </Text>
  );
}

function ChangedSection({ changed }: { readonly changed: ChangedSectionView }) {
  return (
    <>
      <SectionHeading title="What changed, and when" />
      <Stack gap="xs">
        <SurfaceCard tone="accent">
          <Eyebrow>{`${changed.label} — until ${changed.when} we believed`}</Eyebrow>
          <Text mt={4}>{changed.before}</Text>
        </SurfaceCard>
        <SurfaceCard>
          <Eyebrow>{`On ${changed.when} we replaced it with`}</Eyebrow>
          <Text mt={4}>{changed.after}</Text>
        </SurfaceCard>
        {changed.consequence === null ? null : (
          <SurfaceCard tone="highlight">
            <Text fw={650}>{changed.consequence}</Text>
          </SurfaceCard>
        )}
      </Stack>
    </>
  );
}

function doubtKey(doubt: AudienceDoubtView): string {
  return doubt.kind === "proposal" ? `proposal:${doubt.statement}` : `stated:${doubt.factKind}`;
}
