// The stub contract's replacement (AD-7.1): what stays true — no ordinals, no
// fake success, no navigation — and the new truth: one tap affordance, gated
// server-side. `stub-steps.test.ts` retires in the same commit as the swap.
import { describe, expect, test } from "bun:test";
import { createElement, Fragment, type ComponentType, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import {
  AppRouterContext,
  type AppRouterInstance,
} from "next/dist/shared/lib/app-router-context.shared-runtime";

import {
  COMING_NEXT_DESCRIPTORS,
  FIELD_PERSONAL_KEY_LABEL,
  ROADMAP_LEAD,
  STEP_DESCRIPTORS,
  STEP_SLACK_TITLE,
  type ComingNextStep,
  type StepView,
  type WorkStep,
} from "@growthmind/shared";

import {
  assertUnderConstruction,
  loadValueUnderConstruction,
  readSourceUnderConstruction,
  underConstructionSpecifier,
} from "../../../../packages/shared/__tests__/onboarding/module-under-construction";
import { StepRow } from "../../components/first-run/StepRow";
import {
  blankComments,
  fixture,
  offenders,
  readExisting,
  type ScannedFile,
} from "./helpers/first-run-source";
import { readMarkup, type RenderedCard } from "./helpers/rendered-markup";

const OWNER_ROADMAP = "ADD O-024 AD-8 (apps/web/components/first-run/Roadmap.tsx — gains the two status props)";
const OWNER_SOON_CARD = "ADD O-024 AD-8 (apps/web/components/first-run/SoonCard.tsx — the single soon-card renderer)";
const OWNER_CHIPS = "ADD O-024 AD-8 (apps/web/components/first-run/ProviderChips.tsx — one chip renderer for both card kinds)";
const OWNER_ANALYTICS = "ADD O-024 AD-8 (apps/web/components/first-run/ConnectAnalyticsForm.tsx — hosts the analytics chip row)";
const OWNER_MESSAGES = "ADD O-024 AD-7.2 (packages/shared/src/onboarding/messages.ts — the five interest constants)";
const OWNER_CATALOGUE = "ADD O-024 AD-4 (packages/shared/src/onboarding/providers.ts — the provider catalogue)";

const ROADMAP_SOURCE = "apps/web/components/first-run/Roadmap.tsx";
const SOON_CARD_SOURCE = "apps/web/components/first-run/SoonCard.tsx";
const PROVIDER_CHIPS_SOURCE = "apps/web/components/first-run/ProviderChips.tsx";
const ANALYTICS_CARD_SOURCE = "apps/web/components/first-run/ConnectAnalyticsForm.tsx";
const PAGE_SOURCE = "apps/web/app/(first-run)/first-run/page.tsx";

const scanned = (repoRelativePath: string, ownedBy: string): ScannedFile => ({
  file: repoRelativePath,
  source: readSourceUnderConstruction({ repoRelativePath, ownedBy }),
});

interface ProviderDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly rail: string;
  readonly live: boolean;
}

const loadCatalogue = (): Promise<readonly ProviderDescriptor[]> =>
  loadValueUnderConstruction<readonly ProviderDescriptor[]>({
    modulePath: underConstructionSpecifier("packages/shared/src/onboarding/providers"),
    exportName: "PROVIDER_CATALOGUE",
    ownedBy: OWNER_CATALOGUE,
  });

const loadMessage = (exportName: string): Promise<string> =>
  loadValueUnderConstruction<string>({
    modulePath: underConstructionSpecifier("packages/shared/src/onboarding/messages"),
    exportName,
    ownedBy: OWNER_MESSAGES,
  });

interface InterestStatusProps {
  readonly providerInterest: readonly string[];
  readonly interestPingAvailable: boolean;
}

type RoadmapProps = InterestStatusProps & { readonly steps: readonly ComingNextStep[] };

type AnalyticsCardProps = InterestStatusProps & {
  readonly step: WorkStep;
  readonly view: StepView;
  readonly connectionMessage: string;
};

const loadRoadmap = (): Promise<ComponentType<RoadmapProps>> =>
  loadValueUnderConstruction<ComponentType<RoadmapProps>>({
    modulePath: underConstructionSpecifier("apps/web/components/first-run/Roadmap"),
    exportName: "Roadmap",
    ownedBy: OWNER_ROADMAP,
  });

const loadAnalyticsCard = (): Promise<ComponentType<AnalyticsCardProps>> =>
  loadValueUnderConstruction<ComponentType<AnalyticsCardProps>>({
    modulePath: underConstructionSpecifier("apps/web/components/first-run/ConnectAnalyticsForm"),
    exportName: "ConnectAnalyticsForm",
    ownedBy: OWNER_ANALYTICS,
  });

// Props erase at runtime, so without these gates every row below would green
// against today's chip-less tree (the D11 vacuous-green shape).
function roadmapTakesTheStatusProps(): void {
  const source = blankComments(scanned(ROADMAP_SOURCE, OWNER_ROADMAP).source);

  assertUnderConstruction(
    /\bproviderInterest\b/.test(source) && /\binterestPingAvailable\b/.test(source),
    {
      contract:
        "Roadmap takes `providerInterest` and `interestPingAvailable` and hands them to the " +
        "soon cards — today it takes `steps` alone, so the noted state has no way onto the screen (AD-8)",
      ownedBy: OWNER_ROADMAP,
    },
  );
}

function analyticsCardTakesTheChips(): void {
  const source = blankComments(scanned(ANALYTICS_CARD_SOURCE, OWNER_ANALYTICS).source);

  assertUnderConstruction(/\binterestPingAvailable\b/.test(source), {
    contract:
      "ConnectAnalyticsForm hosts the analytics chip row above the unchanged form and takes " +
      "`interestPingAvailable` — today the flag has no consumer on that card (AD-8)",
    ownedBy: OWNER_ANALYTICS,
  });
}

const FAKE_ROUTER: AppRouterInstance = {
  back: () => {},
  forward: () => {},
  refresh: () => {},
  push: () => {},
  replace: () => {},
  prefetch: () => {},
};

const render = (node: ReactElement): string =>
  renderToStaticMarkup(
    createElement(
      MantineProvider,
      null,
      createElement(AppRouterContext.Provider, { value: FAKE_ROUTER }, node),
    ),
  );

interface Rendered {
  readonly html: string;
  readonly card: RenderedCard;
}

async function renderRoadmap(status: InterestStatusProps): Promise<Rendered> {
  roadmapTakesTheStatusProps();
  const Roadmap = await loadRoadmap();
  const html = render(createElement(Roadmap, { steps: COMING_NEXT_DESCRIPTORS, ...status }));
  return { html, card: readMarkup(html) };
}

function analyticsStep(): WorkStep {
  const found = STEP_DESCRIPTORS.find((descriptor) => descriptor.id === "analytics");
  if (found === undefined || found.kind !== "work") {
    throw new Error("STEP_DESCRIPTORS carries no `work` step `analytics` — the sequence changed shape.");
  }
  return found;
}

const ACTIVE_ANALYTICS_VIEW: StepView = {
  id: "analytics",
  ordinal: 2,
  state: "active",
  open: true,
  interactive: true,
};

async function renderAnalyticsCard(status: InterestStatusProps): Promise<Rendered> {
  analyticsCardTakesTheChips();
  const Card = await loadAnalyticsCard();
  const html = render(
    createElement(Card, {
      step: analyticsStep(),
      view: ACTIVE_ANALYTICS_VIEW,
      connectionMessage: "soon-cards-connection-sentence",
      ...status,
    }),
  );
  return { html, card: readMarkup(html) };
}

async function roadmapSoonChipCount(): Promise<number> {
  const catalogue = await loadCatalogue();
  const soon = catalogue.filter((provider) => !provider.live && provider.rail !== "analytics");
  expect(soon.length).toBeGreaterThan(0);
  return soon.length;
}

interface OrderVerdict {
  readonly ok: boolean;
  readonly why: string;
}

function leadAfterLiveMarkers(text: string): OrderVerdict {
  const lead = text.indexOf(ROADMAP_LEAD);
  const key = text.lastIndexOf(FIELD_PERSONAL_KEY_LABEL);
  const slack = text.lastIndexOf(STEP_SLACK_TITLE);

  if (lead === -1) return { ok: false, why: "the roadmap lead is not on the page" };
  if (key === -1) return { ok: false, why: "the personal-key field label is not on the page" };
  if (slack === -1) return { ok: false, why: "the Slack card title is not on the page" };
  if (lead < key) {
    return { ok: false, why: "the soon section renders before the key field — the 2026-08-01 incident class" };
  }
  if (lead < slack) return { ok: false, why: "the soon section renders before the Slack card" };
  return { ok: true, why: "" };
}

const PLANTED_INVERSION =
  `<main><section><h3>${ROADMAP_LEAD}</h3><p>Connect your code</p></section>` +
  `<section><label>${FIELD_PERSONAL_KEY_LABEL}</label><h3>${STEP_SLACK_TITLE}</h3></section></main>`;

const CLEAN_ORDER =
  `<main><section><label>${FIELD_PERSONAL_KEY_LABEL}</label><h3>${STEP_SLACK_TITLE}</h3></section>` +
  `<section><h3>${ROADMAP_LEAD}</h3><p>Connect your code</p></section></main>`;

const ORDINAL_REFS = /\bordinal\b|\bdisplayOrdinal\b/;

const STANDALONE_DIGIT = /(?:^|\s)\d+(?:\s|$)/;

const PLANTED_ORDINAL = fixture(
  "PlantedSoonOrdinal",
  `export function SoonCard({ step }: { step: ComingNextStep }) {
  return <Text>{displayOrdinal(step.id)} {step.title}</Text>;
}
`,
);

const CLEAN_SOON_CARD = fixture(
  "CleanSoonCard",
  `export function SoonCard({ step }: { step: ComingNextStep }) {
  return <Text c="dimmed">{step.title}</Text>;
}
`,
);

const NAV_BANS = /\bAnchor\b|\bhref\b|<a\s|\bTextInput\b|\bPasswordInput\b/;

const PLANTED_NAV_CHIP = fixture(
  "PlantedNavChip",
  `export function ProviderChips() {
  return <Anchor href="/integrations">GitHub</Anchor>;
}
`,
);

const CLEAN_PING_CHIP = fixture(
  "CleanPingChip",
  `export function ProviderChips({ onPing }: { onPing: () => void }) {
  return <Button variant="default" size="xs" radius="xl" onClick={onPing}>Ping me</Button>;
}
`,
);

const NAV_MARKUP = /<a[\s>]|\bhref=|<input/;

describe("the soon-card contract — W-34..W-39 (AD-7.1, AD-8)", () => {
  test("both soon cards render after every live card, and the scanner fails a planted inversion", async () => {
    expect(leadAfterLiveMarkers(readMarkup(PLANTED_INVERSION).text).ok).toBe(false);
    expect(
      leadAfterLiveMarkers(readMarkup(PLANTED_INVERSION).text).why,
    ).toContain("before the key field");

    const clean = leadAfterLiveMarkers(readMarkup(CLEAN_ORDER).text);
    if (!clean.ok) throw new Error(`the clean control failed: ${clean.why}`);

    const missingLead = `<label>${FIELD_PERSONAL_KEY_LABEL}</label><h3>${STEP_SLACK_TITLE}</h3>`;
    expect(leadAfterLiveMarkers(readMarkup(missingLead).text).ok).toBe(false);

    const page = blankComments(readExisting(PAGE_SOURCE).source);
    expect(page.indexOf("<StepRow")).toBeGreaterThan(-1);
    expect(page.indexOf("<Roadmap")).toBeGreaterThan(page.indexOf("<StepRow"));

    roadmapTakesTheStatusProps();
    analyticsCardTakesTheChips();
    const Roadmap = await loadRoadmap();
    const Card = await loadAnalyticsCard();
    const step = analyticsStep();

    // The page's composition, in the page's order: live cards, then the section.
    const html = render(
      createElement(
        Fragment,
        null,
        createElement(
          StepRow,
          { ordinal: 1, title: step.title, helper: step.helper, state: "active", open: true },
          createElement(Card, {
            step,
            view: ACTIVE_ANALYTICS_VIEW,
            connectionMessage: "soon-cards-connection-sentence",
            providerInterest: [],
            interestPingAvailable: true,
          }),
        ),
        createElement(StepRow, {
          ordinal: 2,
          title: STEP_SLACK_TITLE,
          helper: null,
          state: "pending",
          open: false,
        }),
        createElement(Roadmap, {
          steps: COMING_NEXT_DESCRIPTORS,
          providerInterest: [],
          interestPingAvailable: true,
        }),
      ),
    );

    const verdict = leadAfterLiveMarkers(readMarkup(html).text);
    if (!verdict.ok) throw new Error(verdict.why);
  });

  test("soon cards carry no ordinal — not in source, not on the screen", async () => {
    expect(offenders([PLANTED_ORDINAL], ORDINAL_REFS)).not.toEqual([]);
    expect(offenders([CLEAN_SOON_CARD], ORDINAL_REFS)).toEqual([]);
    expect(STANDALONE_DIGIT.test(readMarkup("<p>5 Connect your code</p>").text)).toBe(true);
    expect(STANDALONE_DIGIT.test(readMarkup("<p>Connect your code</p>").text)).toBe(false);

    expect(offenders([scanned(SOON_CARD_SOURCE, OWNER_SOON_CARD)], ORDINAL_REFS)).toEqual([]);

    const { card } = await renderRoadmap({ providerInterest: [], interestPingAvailable: true });
    expect(STANDALONE_DIGIT.test(card.text)).toBe(false);
  });

  test("interestPingAvailable=true renders one ping control per soon chip", async () => {
    const control = readMarkup(
      "<div><button>Ping me when ready</button><button>Ping me when ready</button><span>Coming soon</span></div>",
    );
    expect(control.controls).toHaveLength(2);

    const { card } = await renderRoadmap({ providerInterest: [], interestPingAvailable: true });
    const pingLabel = await loadMessage("INTEREST_PING_LABEL");

    const pings = card.controls.filter((label) => label.includes(pingLabel));
    expect(pings).toHaveLength(await roadmapSoonChipCount());
  });

  test("interestPingAvailable=false renders badge-only soon cards with zero controls", async () => {
    expect(readMarkup("<div><span>Coming soon</span></div>").controls).toEqual([]);

    const { html, card } = await renderRoadmap({
      providerInterest: [],
      interestPingAvailable: false,
    });

    expect(card.controls).toEqual([]);
    expect(html).not.toContain("<button");
    expect(/tabindex/i.test(html)).toBe(false);

    const badge = await loadMessage("PROVIDER_SOON_BADGE");
    expect(card.text.split(badge).length - 1).toBe(await roadmapSoonChipCount());
  });

  test("the only interactive element on a soon card is the ping chip — no links, no anchors, no inputs", async () => {
    expect(offenders([PLANTED_NAV_CHIP], NAV_BANS)).not.toEqual([]);
    expect(offenders([CLEAN_PING_CHIP], NAV_BANS)).toEqual([]);
    expect(NAV_MARKUP.test('<a href="/x">GitHub</a>')).toBe(true);
    expect(NAV_MARKUP.test('<input type="text"/>')).toBe(true);
    expect(NAV_MARKUP.test("<button>Ping me</button>")).toBe(false);

    for (const file of [
      scanned(SOON_CARD_SOURCE, OWNER_SOON_CARD),
      scanned(PROVIDER_CHIPS_SOURCE, OWNER_CHIPS),
    ]) {
      expect(offenders([file], NAV_BANS)).toEqual([]);
    }

    const { html, card } = await renderRoadmap({
      providerInterest: [],
      interestPingAvailable: true,
    });
    const pingLabel = await loadMessage("INTEREST_PING_LABEL");

    expect(card.controls.length).toBeGreaterThan(0);
    for (const label of card.controls) {
      expect(label).toContain(pingLabel);
    }
    expect(NAV_MARKUP.test(html)).toBe(false);
  });

  test("a fresh org renders every chip idle: no noted badge, no ✓, key field present with zero taps", async () => {
    expect(readMarkup("<span>On the list ✓</span>").text).toContain("✓");

    const roadmap = await renderRoadmap({ providerInterest: [], interestPingAvailable: true });
    const notedBadge = await loadMessage("INTEREST_NOTED_BADGE");

    expect(roadmap.card.text).not.toContain("✓");
    expect(roadmap.card.text).not.toContain(notedBadge);

    const analytics = await renderAnalyticsCard({
      providerInterest: [],
      interestPingAvailable: true,
    });

    expect(analytics.card.text).toContain(FIELD_PERSONAL_KEY_LABEL);
    expect(analytics.card.text).not.toContain("✓");
    expect(analytics.card.text).not.toContain(notedBadge);

    const catalogue = await loadCatalogue();
    for (const provider of catalogue.filter((entry) => entry.rail === "analytics")) {
      expect(analytics.card.text).toContain(provider.displayName);
    }
  });

  test("a payload with noted providers renders those chips noted-on-load: badge only, no sentence", async () => {
    const catalogue = await loadCatalogue();
    const soon = catalogue.filter((provider) => !provider.live && provider.rail !== "analytics");
    const noted = soon[0]?.id ?? "";
    expect(noted.length).toBeGreaterThan(0);

    const { card } = await renderRoadmap({
      providerInterest: [noted],
      interestPingAvailable: true,
    });

    const notedBadge = await loadMessage("INTEREST_NOTED_BADGE");
    const template = await loadMessage("INTEREST_NOTED_TEMPLATE");
    const sentencePrefix = (template.split("{provider}")[0] ?? "").trim();

    expect(sentencePrefix.length).toBeGreaterThan(0);
    expect(sentencePrefix).not.toBe(notedBadge);

    expect(card.text).toContain(notedBadge);
    expect(card.text).not.toContain(sentencePrefix);

    const pingLabel = await loadMessage("INTEREST_PING_LABEL");
    const pings = card.controls.filter((label) => label.includes(pingLabel));
    expect(pings).toHaveLength(soon.length - 1);
  });
});
