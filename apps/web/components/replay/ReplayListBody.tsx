import { Button, Stack, Text } from "@mantine/core";

import { provenanceSentence, wayOutAction, wayOutBody } from "@growthmind/core";
import {
  REPLAY_CLEAR_ALL_ACTION,
  REPLAY_CLEAR_COMPANY_ACTION,
  REPLAY_CLEAR_ENTRY_ACTION,
  REPLAY_COUNTS_ARE_A_FLOOR_NOTICE,
  REPLAY_DEFAULT_LANE,
  REPLAY_FAILED_BODY,
  REPLAY_FAILED_TITLE,
  REPLAY_FILTER_PARAMS,
  REPLAY_NONE_YET_TITLE,
  REPLAY_NOT_CONNECTED_ACTION,
  REPLAY_NOT_CONNECTED_BODY,
  REPLAY_NOT_CONNECTED_TITLE,
  REPLAY_NOTHING_LEFT_OUT_BODY,
  REPLAY_NOTHING_LEFT_OUT_TITLE,
  REPLAY_OVER_FILTERED_TITLE,
  REPLAY_SHOW_ALL_COMPANIES_ACTION,
  REPLAY_SHOW_REAL_PEOPLE_ACTION,
  REPLAY_SIMULATED_ZERO_BODY,
  REPLAY_SIMULATED_ZERO_TITLE,
  REPLAY_TRY_AGAIN_ACTION,
  REPLAY_VALUE_MATCHES_NOTHING_BODY,
  REPLAY_ZERO_FOR_COMPANY_BODY,
  REPLAY_ZERO_FOR_COMPANY_TITLE,
  REPLAY_ZERO_FOR_SELECTION_BODY,
  REPLAY_ZERO_FOR_SELECTION_TITLE,
} from "@growthmind/shared";
import type { ReplayFilters } from "@growthmind/shared";

import { ButtonLink } from "@/components/ui/Links";
import { EmptyState } from "@/components/ui/EmptyState";
import type { ReplayScreen } from "@/lib/replay/read";
import { ROUTES } from "@/lib/routes";

import { fill } from "@growthmind/core";
import { ReplayRow } from "./ReplayRow";
import { clearedReplayUrl, nextReplayUrl, replayUrlOf } from "./filters/filter-url";

type ScreenArm = Extract<ReplayScreen, { readonly kind: "screen" }>;

interface ReplayListBodyProps {
  readonly screen: ReplayScreen;
  readonly filters: ReplayFilters;
}

interface Terminal {
  readonly heading: string;
  readonly body: string;
  readonly action: string;
  readonly href: string;
}

const RELAX_PARAMS = {
  company: REPLAY_FILTER_PARAMS.company,
  entry: REPLAY_FILTER_PARAMS.entry,
  lane: REPLAY_FILTER_PARAMS.who,
} as const;

// A link that lands on the current state is not an escape. When the change the state offers is
// somehow already made, the link at least repaints the screen it describes.
function urlOr(url: string | null, filters: ReplayFilters): string {
  return url ?? replayUrlOf(filters);
}

function dropped(filters: ReplayFilters, param: string): string {
  return urlOr(nextReplayUrl(filters, param, null), filters);
}

// R-3: the state that clears one filter clears exactly that one. Throwing away the rest is
// throwing away work someone did on purpose.
function zeroForSelection(filters: ReplayFilters, sessions: string): Terminal {
  if (filters.company !== null) {
    return {
      heading: fill(REPLAY_ZERO_FOR_COMPANY_TITLE, { company: filters.company }),
      body: fill(REPLAY_ZERO_FOR_COMPANY_BODY, { sessions, company: filters.company }),
      action: REPLAY_SHOW_ALL_COMPANIES_ACTION,
      href: dropped(filters, REPLAY_FILTER_PARAMS.company),
    };
  }

  const single = filters.entry !== null && filters.lane === REPLAY_DEFAULT_LANE;

  return {
    heading: REPLAY_ZERO_FOR_SELECTION_TITLE,
    body: fill(REPLAY_ZERO_FOR_SELECTION_BODY, { sessions }),
    action: single ? REPLAY_CLEAR_ENTRY_ACTION : REPLAY_CLEAR_ALL_ACTION,
    href: single
      ? dropped(filters, REPLAY_FILTER_PARAMS.entry)
      : urlOr(clearedReplayUrl(filters), filters),
  };
}

// E5 is the tenant boundary too: a cross-org value, a guessed one and one that aged out all
// arrive here in the same shape, and nothing below tells them apart.
function valueMatchesNothing(filters: ReplayFilters): Terminal {
  const onCompany = filters.company !== null;
  const value = (onCompany ? filters.company : filters.entry) ?? "";

  return {
    heading: REPLAY_OVER_FILTERED_TITLE,
    body: fill(REPLAY_VALUE_MATCHES_NOTHING_BODY, { value }),
    action: onCompany ? REPLAY_CLEAR_COMPANY_ACTION : REPLAY_CLEAR_ENTRY_ACTION,
    href: dropped(filters, onCompany ? REPLAY_FILTER_PARAMS.company : REPLAY_FILTER_PARAMS.entry),
  };
}

function terminalOf(screen: ScreenArm, filters: ReplayFilters): Terminal | null {
  const { outcome } = screen;
  const sessions = String(screen.provenance.sessions);

  if (outcome === "rows") return null;

  if (outcome === "simulated_permanent_zero") {
    return {
      heading: REPLAY_SIMULATED_ZERO_TITLE,
      body: fill(REPLAY_SIMULATED_ZERO_BODY, { sessions }),
      action: REPLAY_SHOW_REAL_PEOPLE_ACTION,
      href: dropped(filters, REPLAY_FILTER_PARAMS.who),
    };
  }

  if (outcome === "nothing_left_out") {
    return {
      heading: REPLAY_NOTHING_LEFT_OUT_TITLE,
      body: REPLAY_NOTHING_LEFT_OUT_BODY,
      action: REPLAY_SHOW_REAL_PEOPLE_ACTION,
      href: dropped(filters, REPLAY_FILTER_PARAMS.who),
    };
  }

  if (outcome === "value_matches_nothing") return valueMatchesNothing(filters);

  if (outcome === "zero_replays_for_selection") return zeroForSelection(filters, sessions);

  // The three the way out owns: its body names which filter is the reason, and its action is
  // the one that restores results rather than the one that clears everything.
  const body = wayOutBody(outcome, filters);
  const action = wayOutAction(outcome);

  if (body === null || action === null) return null;

  if (outcome === "no_replays_yet") {
    return { heading: REPLAY_NONE_YET_TITLE, body, action, href: ROUTES.settings };
  }

  return {
    heading: REPLAY_OVER_FILTERED_TITLE,
    body,
    action,
    href:
      outcome === "clear_all"
        ? urlOr(clearedReplayUrl(filters), filters)
        : dropped(filters, RELAX_PARAMS[outcome.relax]),
  };
}

export function ReplayListBody({ screen, filters }: ReplayListBodyProps) {
  // The app shell resolves the session before this renders; the arm exists so the reader's union
  // stays total.
  if (screen.kind === "signed_out") return null;

  if (screen.kind === "not_connected") {
    return (
      <EmptyState
        heading={REPLAY_NOT_CONNECTED_TITLE}
        body={REPLAY_NOT_CONNECTED_BODY}
        action={<ButtonLink href={ROUTES.settings}>{REPLAY_NOT_CONNECTED_ACTION}</ButtonLink>}
      />
    );
  }

  if (screen.kind === "failed") {
    // A full request rather than a client navigation: the read that failed is the one the
    // button has to run again, and it runs on the server under the filters it carries.
    return (
      <EmptyState
        heading={REPLAY_FAILED_TITLE}
        body={REPLAY_FAILED_BODY}
        action={
          <Button component="a" href={replayUrlOf(screen.filters)}>
            {REPLAY_TRY_AGAIN_ACTION}
          </Button>
        }
      />
    );
  }

  const terminal = terminalOf(screen, filters);

  return (
    <Stack gap="sm">
      {/* Control, then claim, then evidence. The denominator never disappears, not even under a
          terminal state, so "nothing" is always "nothing out of how many". */}
      <Text size="sm" c="dimmed" aria-live="polite" style={{ minHeight: 19 }}>
        {provenanceSentence(screen.provenance, filters)}
      </Text>

      {terminal === null ? (
        <Stack gap="sm">
          {screen.rows.map((row) => (
            <ReplayRow key={row.sessionKey} row={row} />
          ))}
        </Stack>
      ) : (
        <EmptyState
          heading={terminal.heading}
          body={terminal.body}
          action={<ButtonLink href={terminal.href}>{terminal.action}</ButtonLink>}
        />
      )}

      {screen.tailNote === null ? null : (
        <Text size="sm" c="dimmed">
          {screen.tailNote}
        </Text>
      )}

      {/* A different sentence about a different fact: one says some matching sessions have no
          replay, the other says the count itself is a floor. Both can be true at once. */}
      {screen.truncated ? (
        <Text size="sm" c="dimmed">
          {REPLAY_COUNTS_ARE_A_FLOOR_NOTICE}
        </Text>
      ) : null}
    </Stack>
  );
}
