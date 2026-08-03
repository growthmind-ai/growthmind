"use client";

// The Slack connection. Four card states in one component, branching on the
// server-computed `slackOAuthAvailable`: the one-click button with the token
// form folded behind it, the token form as the card, the channel picker, and no
// body at all once a channel is chosen. Mounted as setup's step 3 and as the
// settings page that outlives it; "Skip for now" is in every unsettled state of
// the former and none of the latter.
import { Button, Collapse, Group, Loader, Select, Stack, Text } from "@mantine/core";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { isDeliveryAddress, ONBOARDING_MESSAGES, type FieldDescriptor } from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";
import { slackOAuthOutcomeOf, type SlackOAuthOutcome } from "@/lib/first-run/slack-oauth-outcome";

import {
  FIRST_RUN_API,
  getJson,
  postForOutcome,
  postJson,
  readChannelList,
  readRefusal,
  readTestPostAnswer,
  type SlackChannelChoice,
  type TestPostAnswer,
} from "../first-run/api";
import { FieldRow } from "../first-run/FieldRow";
import { changeField, initialValues, type FieldValues } from "../first-run/form-fields";

const BOT_TOKEN = "botToken";
const CHANNEL_ID = "channelId";

interface OutcomeNotice {
  readonly sentence: string;
  // Three of the six outcomes are not faults, and are not marked as such.
  readonly unexpected: boolean;
}

// Total by type (D9): a seventh outcome is a compile error here, not a landing
// that silently says nothing.
const OAUTH_NOTICES: Record<SlackOAuthOutcome, OutcomeNotice> = {
  connected: { sentence: ONBOARDING_MESSAGES.slackOAuthConnected, unexpected: false },
  declined: { sentence: ONBOARDING_MESSAGES.slackOAuthDeclined, unexpected: false },
  expired: { sentence: ONBOARDING_MESSAGES.slackOAuthExpired, unexpected: true },
  "already-connected": {
    sentence: ONBOARDING_MESSAGES.slackOAuthAlreadyConnected,
    unexpected: false,
  },
  unavailable: { sentence: ONBOARDING_MESSAGES.slackOAuthUnavailable, unexpected: true },
  failed: { sentence: ONBOARDING_MESSAGES.slackOAuthFailed, unexpected: true },
};

// A list that arrived empty is not a list that did not arrive: `null` is "we
// could not read it", `[]` is "your workspace showed us nothing" (D5).
export function noChannelsVisible(channels: readonly SlackChannelChoice[] | null): boolean {
  return channels !== null && channels.length === 0;
}

// Three fields because there are three facts. As one boolean, "reached the
// post" meant both "address stamped" and "message arrived" — two dead ends.
export interface SendAnswer {
  readonly posted: boolean;
  // The machine code, never rendered; it is here so this card can branch.
  readonly code: string | null;
  readonly marksStepDone: boolean;
}

const CHANNEL_ALREADY_CHOSEN = "channel_already_chosen";

// Whether the ADDRESS is stamped, not whether the post worked: a failed post
// never rolls back a correct pick, and the 409 means the server has it (D8).
export function channelAddressLanded(answer: SendAnswer): boolean {
  return answer.posted || answer.code === CHANNEL_ALREADY_CHOSEN;
}

interface ChannelPickerProps {
  readonly channels: readonly SlackChannelChoice[] | null;
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  readonly disabled: boolean;

  // A list still in flight. Without it the wait renders as a greyed dropdown
  // beside a greyed button, which is indistinguishable from a broken screen.
  readonly loading: boolean;
}

// An empty picker is not a picker: the empty answer replaces the control.
export function ChannelPicker(props: ChannelPickerProps): ReactNode {
  if (noChannelsVisible(props.channels)) {
    return (
      <Text size="sm" c="dimmed">
        {ONBOARDING_MESSAGES.slackNoChannelsVisible}
      </Text>
    );
  }

  return (
    <Select
      label={ONBOARDING_MESSAGES.channelLabel}
      description={ONBOARDING_MESSAGES.slackChannelPickPrompt}
      placeholder={ONBOARDING_MESSAGES.channelPlaceholder}
      data={(props.channels ?? []).map((channel) => ({ value: channel.id, label: channel.name }))}
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled || props.channels === null}
      rightSection={props.loading ? <Loader size="xs" /> : null}
      searchable
    />
  );
}

interface SlackConnectionProps {
  // Primitives rather than a step and a view: the same card is the setup step and
  // the settings page's whole body, and post-setup there is no step to skip.
  readonly fields: readonly FieldDescriptor[];
  readonly settled: boolean;
  readonly interactive: boolean;
  readonly skippable: boolean;
  readonly skipped: boolean;

  readonly channelId: string | null;
  // AD-4: EXISTENCE, not address. Never re-derived from `channelId`.
  readonly slackWorkspaceAttached: boolean;
  // Required, not optional (D11). `null` on the pasted-token path.
  readonly slackWorkspaceName: string | null;
  // AD-6. Server-computed, and the client never reads the environment.
  readonly slackOAuthAvailable: boolean;
}

export function SlackConnection(props: SlackConnectionProps) {
  const router = useRouter();

  // Derived here rather than handed down (D11): the callback route puts the
  // outcome on the address bar and this card reads it back itself.
  const search: URLSearchParams | null = useSearchParams();
  const landing: SlackOAuthOutcome | null = search === null ? null : slackOAuthOutcomeOf(search);
  const notice = landing === null ? null : OAUTH_NOTICES[landing];

  const [values, setValues] = useState<FieldValues>(() => initialValues(props.fields));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<TestPostAnswer | null>(null);
  const [disclosed, setDisclosed] = useState(false);
  const [channels, setChannels] = useState<readonly SlackChannelChoice[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [listingAttempt, setListingAttempt] = useState(0);
  // What THIS VISIT attached, OR-ed with the persisted answer below rather than
  // seeded from it — a seeded value keeps saying the old thing after a refresh.
  const [workspaceNow, setWorkspaceNow] = useState(false);
  const [channelNow, setChannelNow] = useState(false);

  // A 200 carrying a failed post still stamps the address (D8), so `settled`
  // arrives true on the render that must offer the retry its own error names.
  const postFailed = outcome !== null && !outcome.ok;
  const settled = props.settled && !postFailed;
  const locked = pending || !props.interactive;

  const workspaceAttached = props.slackWorkspaceAttached || workspaceNow;
  // The predicate, not `!== null`: a sentinel address is not somewhere to post, and
  // treating one as attached hides the picker from exactly the row that needs it.
  const channelAttached = isDeliveryAddress(props.channelId) || channelNow;

  // The window AD-4 opens: consented, nowhere to post yet, reachable on BOTH
  // paths. `offerOAuth` never re-offers "Add to Slack" to an attached org.
  const picking = !settled && workspaceAttached && !channelAttached;
  const offerOAuth = props.slackOAuthAvailable && !workspaceAttached;

  // Total rather than `!== null`: null, blank and absent all render nothing.
  const named = props.slackWorkspaceName;
  const workspaceName = typeof named === "string" && named.trim() !== "" ? named : null;

  const listUnavailable = picking && channels === null && failure !== null;
  const listEmpty = picking && noChannelsVisible(channels);

  // Two list states, one mechanism and two sentences: asking again is the fix.
  const relistable = listUnavailable || listEmpty;
  const retryable = relistable || (outcome !== null && !outcome.ok && outcome.retryable);

  // AD-7: nothing is cached — a founder told to pick very often makes one first.
  useEffect(() => {
    if (!picking) {
      return undefined;
    }

    let current = true;

    void getJson(FIRST_RUN_API.slackChannels).then((answer) => {
      if (!current) {
        return;
      }
      if (answer === null) {
        setFailure(ONBOARDING_MESSAGES.networkFailure);
        return;
      }

      const list = readChannelList(answer.body);
      if (list === null) {
        setFailure(readRefusal(answer.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
        return;
      }
      setChannels(list);
    });

    return () => {
      current = false;
    };
  }, [picking, listingAttempt]);

  function renderField(field: FieldDescriptor): ReactNode {
    return (
      <FieldRow
        key={field.id}
        field={field}
        value={values[field.id] ?? ""}
        onChange={changeField(setValues, field.id)}
        disabled={locked}
      />
    );
  }

  // POST, render whatever came back, and report WHAT it was rather than whether
  // it went well. No refresh of its own: the two callers refresh on different
  // facts.
  async function sendTo(path: string, body: unknown): Promise<SendAnswer> {
    const answer = await postJson(path, body);

    if (answer === null) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return {
        posted: false,
        code: null,
        marksStepDone: false,
      };
    }

    const read = readTestPostAnswer(answer.body);
    if (read === null) {
      const refusal = readRefusal(answer.body);
      setFailure(refusal?.message ?? ONBOARDING_MESSAGES.networkFailure);
      return {
        posted: false,
        code: refusal?.code ?? null,
        marksStepDone: false,
      };
    }

    setOutcome(read);
    return {
      posted: true,
      code: null,
      marksStepDone: read.marksStepDone,
    };
  }

  // The post itself, which is the only half a retry repeats.
  async function post(): Promise<void> {
    const answer = await sendTo(FIRST_RUN_API.slackTest, {});
    if (answer.marksStepDone) {
      router.refresh();
    }
  }

  async function send(): Promise<void> {
    setPending(true);
    setFailure(null);
    setOutcome(null);

    // Everything is attached already; this press is the post and nothing else.
    if (channelAttached) {
      await post();
      setPending(false);
      return;
    }

    // A workspace and no address: one call attaches and posts. THE ADDRESS
    // LANDING MOVES THIS CARD ON, NOT THE POST SUCCEEDING — without the refresh
    // every later press meets the once-only guard's 409.
    if (workspaceAttached) {
      const answer = await sendTo(FIRST_RUN_API.slackChannel, { channelId: choice ?? "" });

      if (channelAddressLanded(answer)) {
        setChannelNow(true);
        router.refresh();
      }
      setPending(false);
      return;
    }

    const attached = await postForOutcome(
      FIRST_RUN_API.slackConnect,
      {
        botToken: values[BOT_TOKEN] ?? "",
        channelId: values[CHANNEL_ID] ?? "",
      },
      ONBOARDING_MESSAGES.networkFailure,
    );

    if (!attached.ok) {
      setPending(false);
      setFailure(attached.message);
      return;
    }

    setWorkspaceNow(true);
    setChannelNow(true);
    await post();
    setPending(false);
  }

  async function retry(): Promise<void> {
    setFailure(null);
    setOutcome(null);

    // The list never arrived, or arrived empty and the bot has since been
    // invited: asking again is the whole retry. The old answer goes back to "we
    // do not know" first, so a failed re-list leaves no stale claim on screen.
    if (relistable) {
      setChannels(null);
      setListingAttempt((attempt) => attempt + 1);
      return;
    }

    setPending(true);
    await post();
    setPending(false);
  }

  async function skip(): Promise<void> {
    setPending(true);
    setFailure(null);

    const answer = await postForOutcome(
      FIRST_RUN_API.slackSkip,
      {},
      ONBOARDING_MESSAGES.networkFailure,
    );
    setPending(false);

    if (!answer.ok) {
      setFailure(answer.message);
      return;
    }
    router.refresh();
  }

  function sendButton(): ReactNode {
    return (
      <Button
        onClick={() => void send()}
        loading={pending}
        disabled={locked || (picking && choice === null)}
        style={tapTargetStyle}
        w={{ base: "100%", xs: "auto" }}
      >
        {pending ? ONBOARDING_MESSAGES.sendingTestMessage : ONBOARDING_MESSAGES.sendTestMessage}
      </Button>
    );
  }

  function tokenFields(): ReactNode {
    return <Stack gap="sm">{props.fields.map((field) => renderField(field))}</Stack>;
  }

  // THE INVARIANT: the pasted-token form may never render on an organization
  // that already has a workspace attached. An attached org with a channel gets
  // no card body and no re-pick control (`attachChannel` never moves a chosen
  // address, D12); send and skip live outside this function.
  function card(): ReactNode {
    if (settled) {
      return null;
    }

    if (picking) {
      return (
        <ChannelPicker
          channels={channels}
          value={choice}
          onChange={setChoice}
          disabled={locked}
          loading={channels === null && failure === null}
        />
      );
    }

    if (workspaceAttached) {
      return null;
    }

    // Folded rather than absent: a self-hoster still needs the token form here.
    if (offerOAuth) {
      return (
        <Stack gap={4}>
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            onClick={() => setDisclosed((open) => !open)}
            style={tapTargetStyle}
          >
            {ONBOARDING_MESSAGES.slackOwnAppDisclosure}
          </Button>

          <Collapse expanded={disclosed}>
            <Stack gap="sm">
              {tokenFields()}
              {sendButton()}
            </Stack>
          </Collapse>
        </Stack>
      );
    }

    return tokenFields();
  }

  return (
    <Stack gap="sm">
      {/* What the trip out to Slack settled, before anything else on the card:
          it answers the question the founder came back with. */}
      {notice === null ? null : (
        <Text size="sm" c={notice.unexpected ? "stamp.4" : "dimmed"}>
          {notice.sentence}
        </Text>
      )}

      {/* Which workspace, directly above the picker: somebody with two of them
          picking a channel in the wrong one finds out when what we find arrives
          somewhere nobody reads. Gated on `workspaceName` so the pasted-token
          path renders nothing rather than a sentence with a hole in it. */}
      {picking && workspaceName !== null ? (
        <Text size="sm" c="dimmed">
          {ONBOARDING_MESSAGES.slackWorkspaceConnectedTemplate.replaceAll(
            "{workspace}",
            workspaceName,
          )}
        </Text>
      ) : null}

      {card()}

      {outcome === null ? null : (
        <Text size="sm" c={outcome.ok ? "dimmed" : "stamp.4"}>
          {outcome.sentence}
        </Text>
      )}

      {failure === null ? null : (
        <Text size="sm" c="stamp.4">
          {failure}
        </Text>
      )}

      {/* FR-O14, derived from the persisted absence of a connection, so it
          survives a reload and clears itself when one arrives. */}
      {props.skipped ? (
        <Text size="sm" c="dimmed">
          {ONBOARDING_MESSAGES.slackSkippedNotice}
        </Text>
      ) : null}

      {settled || !props.interactive ? null : (
        <Group gap="sm" wrap="wrap">
          {offerOAuth ? (
            <Button
              component="a"
              href={FIRST_RUN_API.slackOAuthStart}
              style={tapTargetStyle}
              w={{ base: "100%", xs: "auto" }}
            >
              {ONBOARDING_MESSAGES.addToSlack}
            </Button>
          ) : (
            sendButton()
          )}

          {retryable ? (
            <Button
              variant="default"
              onClick={() => void retry()}
              disabled={locked}
              style={tapTargetStyle}
              w={{ base: "100%", xs: "auto" }}
            >
              {ONBOARDING_MESSAGES.tryAgain}
            </Button>
          ) : null}

          {/* Nothing to skip once setup has retired: there this card IS the page. */}
          {props.skippable ? (
            <Button
              variant="subtle"
              color="gray"
              onClick={() => void skip()}
              disabled={locked}
              style={tapTargetStyle}
              w={{ base: "100%", xs: "auto" }}
            >
              {ONBOARDING_MESSAGES.skipForNow}
            </Button>
          ) : null}
        </Group>
      )}
    </Stack>
  );
}
