"use client";

// STEP 3 — SLACK, AND THE SKIP THAT IS A REAL ANSWER
// (O-008, AD-4, AD-6, AD-7, FR-O11, FR-O13, FR-O14, UX Checklist rows 12-16
// and Flow D).
//
// ###########################################################################
// # FOUR CARD STATES, ONE COMPONENT, AND THE BRANCH IS A SERVER-COMPUTED
// # BOOLEAN.
// #
// # `slackOAuthAvailable` says whether THIS INSTALLATION has a Slack app of its
// # own. It is computed in `lib/first-run/status.ts` and arrives as a prop, and
// # the client NEVER reads the environment for it: `SLACK_CLIENT_ID` is a
// # server variable, so reading it here would be `undefined` in the browser and
// # the card would hide the one-click path from exactly the deployments that
// # configured it.
// #
// #   flag TRUE, no workspace yet -> "Add to Slack", with the pasted-token form
// #                                  folded behind a disclosure.
// #   flag FALSE                  -> the pasted-token form IS the card, primary
// #                                  and unfolded. SELF-HOST IS FIRST-CLASS and
// #                                  is never the degraded path.
// #   a workspace, and no channel -> the picker, on either path.
// #   a workspace AND a channel   -> no card body at all. See the invariant on
// #                                  `card()`: THE PASTED-TOKEN FORM MAY NEVER
// #                                  RENDER ON AN ORGANIZATION THAT ALREADY HAS
// #                                  A WORKSPACE ATTACHED.
// #
// # THE PICKER REPLACES THE CHANNEL-ID FIELD RATHER THAN JOINING IT. No id is
// # typed on the one-click path; the list is fetched live at pick time (AD-7)
// # and stored nowhere, so a channel created a minute ago is pickable.
// #
// # "SKIP FOR NOW" IS ALWAYS IN THE ROW, INCLUDING AFTER A FAILURE AND ON ALL
// # THREE CARDS. Deviation 2: a skip a founder cannot find is not a skip.
// # Whatever went wrong with the token, the trip to Slack, the channel or the
// # network, setup is NOT broken and the sequence still reaches step 5 — so the
// # secondary action never disappears and the step never renders as an error
// # state. The branch that decides which card renders is not allowed to decide
// # that too.
// #
// # RETRY IS OFFERED ONLY WHERE IT CAN WORK. Two of the four post failures need
// # a human to go and reconnect or repick before anything can change; offering
// # "Try again" there is a button that can never succeed, and the founder
// # presses it until they give up. The route already computes which ones are
// # retryable from the delivery lane's own opinion, so this form renders that
// # answer rather than forming a second one. The retry this form adds of its
// # own is the channel list, on the two states where asking again is the whole
// # of the fix — see the note on `noChannelsVisible`.
// #
// # ONE PRESS, TWO CALLS, ON BOTH PATHS. "Send a test message" attaches and
// # then posts — the token and channel together on the pasted path, the chosen
// # channel on the one-click path. A separate "Connect" press would buy
// # nothing, because a connection nobody has posted through has proved nothing.
// #
// # THE CHANNEL IS NEVER SENT TO THE TEST ROUTE (FR-O13). It is read from the
// # stored row there. A caller that could name a channel could post this
// # workspace's announcement into one it does not own.
// ###########################################################################
//
// ── WHY `slackWorkspaceAttached` AND NOT `channelId !== null` ───────────────
//
// The two are different facts and this card is where the difference bites. A
// workspace can be attached with no channel — that is the whole window AD-4
// opens by making consent and choosing two separate acts — and deriving "are we
// attached" from the address said NO for every founder sitting in it. The card
// then offered "Add to Slack" to an organization that had already consented,
// and a second consent trip lands on the partial unique index rather than on
// anything useful. `slackWorkspaceAttached` is existence; `channelId` is the
// address; nothing here may collapse them again.
import {
  Button,
  Collapse,
  Group,
  PasswordInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";

import {
  ONBOARDING_MESSAGES,
  type FieldDescriptor,
  type StepView,
  type WorkStep,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";
import { slackOAuthOutcomeOf, type SlackOAuthOutcome } from "@/lib/first-run/slack-oauth-outcome";

import {
  FIRST_RUN_API,
  getJson,
  postJson,
  readChannelList,
  readRefusal,
  readTestPostAnswer,
  type SlackChannelChoice,
  type TestPostAnswer,
} from "./api";
import { initialValues, type FieldValues } from "./form-fields";

/** The two field ids, named once — see the note in step 2's form. */
const BOT_TOKEN = "botToken";
const CHANNEL_ID = "channelId";

/** What the round trip's answer looks like once it reaches the screen. */
interface OutcomeNotice {
  readonly sentence: string;
  /**
   * Whether something went wrong on the way. THREE OF THE SIX DID NOT: a
   * workspace attached, a founder who chose not to grant access, and an
   * organization that was already connected. Marking those would be telling
   * somebody off on the paths where nothing failed.
   */
  readonly unexpected: boolean;
}

/**
 * The vocabulary, given words. TOTAL BY TYPE (D9): a seventh outcome added to
 * `SlackOAuthOutcome` is a compile error here rather than a landing that
 * silently says nothing, which is precisely the state this table ends.
 */
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

/**
 * A LIST THAT ARRIVED WITH NOTHING IN IT, WHICH IS NOT A LIST THAT DID NOT
 * ARRIVE. `null` is "we have not got it back yet, or we could not read it"; an
 * empty array is a successful answer meaning "your workspace showed us nothing".
 *
 * The two states look identical from the picker's own point of view — there is
 * nothing to choose either way — and they have OPPOSITE next actions. One is
 * ours to fetch again; the other needs somebody to go into Slack and invite the
 * bot before a second fetch can say anything different. Collapsing them into one
 * condition hands one of the two the other one's instruction, which is how the
 * founder ends up pressing a button that cannot change anything.
 *
 * One home for the predicate, because both the parent's retry wiring and the
 * picker's own branch ask the same question and must never drift apart.
 */
export function noChannelsVisible(channels: readonly SlackChannelChoice[] | null): boolean {
  return channels !== null && channels.length === 0;
}

/**
 * What one round trip to a first-run verb settled, from this card's side.
 *
 * THREE FIELDS BECAUSE THERE ARE THREE FACTS, AND THEY USED TO BE ONE BOOLEAN.
 * The old `sendTo` answered `true` for "the route got as far as posting", and
 * the channel call read that one boolean as BOTH "the address is stamped" and
 * "the message arrived". They are not the same fact, and collapsing them is
 * what produced this card's two dead ends: a stamped address read as an unsent
 * message left the picker mounted, and an unsent message read as an unstamped
 * address sent the founder back to the pasted-token form.
 */
export interface SendAnswer {
  /** A test-post answer came back, so the route reached the post itself. */
  readonly posted: boolean;
  /**
   * The refusal's machine code, and NEVER RENDERED — the sentence beside it is
   * what a person reads (`readRefusal` keeps the two apart for this reason). It
   * is here so this card can tell one refusal from another.
   */
  readonly code: string | null;
  /** The route's own opinion that this settles the step. Never re-derived. */
  readonly marksStepDone: boolean;
}

/** The channel route's code for "this organization already chose" — see
 *  `channelAlreadyChosen` in `lib/first-run/refusals.ts`. */
const CHANNEL_ALREADY_CHOSEN = "channel_already_chosen";

/**
 * WHETHER THE DELIVERY ADDRESS IS NOW STAMPED, WHICH IS NOT WHETHER THE TEST
 * POST WORKED.
 *
 * Two answers mean it is. A test-post answer means the attach committed and the
 * route went on to post — and the address stands even when that post then
 * failed, because a failed test message never rolls back a correct pick (D8,
 * which the channel route states in its own header). And `channel_already_chosen`
 * is the once-only guard reporting that the address was there before this press:
 * a page opened twice, a teammate who finished the same step first, or this
 * card's own earlier press whose answer never made it back. In both cases the
 * server knows the address and the client must stop arguing with it.
 *
 * EVERY OTHER REFUSAL LEAVES THE ADDRESS UNSTAMPED — a listing that failed, a
 * channel no longer on the live list, no workspace at all — and the founder
 * stays in the picker with the pick still to make. That is the way back to
 * picking, and it is kept by this predicate being narrow rather than by a
 * control: `attachChannel` fills an empty address and never moves a chosen one
 * (D12, `slack-connections.repo.ts`), so a "pick a different channel" button
 * offered after the address landed would post into the 409 every time. This card
 * does not build buttons that cannot work.
 *
 * EXPORTED FOR ITS OWN TEST, for the reason `noChannelsVisible` gives one door
 * up: the answer is only reachable through a press, and the server renderer the
 * first-run suites use dispatches no events.
 */
export function channelAddressLanded(answer: SendAnswer): boolean {
  return answer.posted || answer.code === CHANNEL_ALREADY_CHOSEN;
}

interface ChannelPickerProps {
  readonly channels: readonly SlackChannelChoice[] | null;
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
  /** The form's own lock. Absence of a list disables the picker on top of it. */
  readonly disabled: boolean;
}

/**
 * The picker, or the sentence that stands where it would have been.
 *
 * AN EMPTY PICKER IS NOT A PICKER — it is a control whose only outcome is the
 * one the founder already has, sitting under an instruction to pick, with
 * nothing on screen saying why there is nothing in it. `readChannelList`'s own
 * note says the same thing one layer down. So the empty answer replaces the
 * control rather than filling it, and the retry beside it re-lists rather than
 * re-posting.
 *
 * EXPORTED FOR ITS OWN TEST. The list arrives through an effect, and the server
 * renderer the first-run suites use runs no effects — so the empty state is
 * unreachable through the parent and would be the one state nothing covers.
 */
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
      data={(props.channels ?? []).map((channel) => ({ value: channel.id, label: channel.name }))}
      value={props.value}
      onChange={props.onChange}
      disabled={props.disabled || props.channels === null}
      searchable
    />
  );
}

interface ConnectSlackFormProps {
  readonly step: WorkStep;
  readonly view: StepView;
  /** FR-O13: read from the stored row. `null` until a channel is attached. */
  readonly channelId: string | null;
  /** AD-4 row 4: EXISTENCE, not address. Never re-derived from `channelId`. */
  readonly slackWorkspaceAttached: boolean;
  /**
   * Slack's own name for the attached workspace, and REQUIRED rather than
   * optional on purpose (D11). An optional prop is the severed wire's own
   * shape: every render site keeps typechecking with nothing attached, the
   * "when present…" branch never runs, and the permanent absence reads as the
   * legitimate no-name case. Required makes a caller that forgets it a compile
   * error.
   *
   * `null` on the pasted-token path, which is handed a token and a channel and
   * is never told a name.
   */
  readonly slackWorkspaceName: string | null;
  /** AD-6. Server-computed, and the client never reads the environment. */
  readonly slackOAuthAvailable: boolean;
}

export function ConnectSlackForm(props: ConnectSlackFormProps) {
  const { step, view } = props;
  const router = useRouter();

  // THE OUTCOME IS DERIVED HERE RATHER THAN HANDED DOWN (D11). The callback
  // route puts it on the address bar because a browser lands on it and a
  // founder reading `{"ok":false}` has been dropped outside the product; the
  // card that has to say what happened reads it back itself, so there is no
  // thread through a page and a work-body for anybody to forget to attach.
  //
  // `null` outside a router — a plain visit, which is what an unrecognised
  // value means too.
  const search: URLSearchParams | null = useSearchParams();
  const landing: SlackOAuthOutcome | null = search === null ? null : slackOAuthOutcomeOf(search);
  const notice = landing === null ? null : OAUTH_NOTICES[landing];

  const [values, setValues] = useState<FieldValues>(() => initialValues(step.fields));
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<TestPostAnswer | null>(null);
  const [disclosed, setDisclosed] = useState(false);
  const [channels, setChannels] = useState<readonly SlackChannelChoice[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [listingAttempt, setListingAttempt] = useState(0);
  // What THIS VISIT attached, OR-ed with the persisted answer rather than
  // seeded from it: a second connect on an organization that already has one is
  // refused by a database constraint, and a value seeded into state would keep
  // saying the old thing after the server had moved on.
  const [workspaceNow, setWorkspaceNow] = useState(false);
  const [channelNow, setChannelNow] = useState(false);

  const settled = view.state === "done" || view.state === "skipped";
  const locked = pending || !view.interactive;

  const workspaceAttached = props.slackWorkspaceAttached || workspaceNow;
  const channelAttached = props.channelId !== null || channelNow;

  // The window AD-4 opens: consented, and nowhere to post yet. It is reachable
  // on BOTH paths — an installation whose Slack app is removed after a
  // workspace was attached must not be asked to paste a token it cannot use.
  const picking = !settled && workspaceAttached && !channelAttached;
  const offerOAuth = props.slackOAuthAvailable && !workspaceAttached;

  // A NAME WE ACTUALLY HAVE, AND THE TEST IS TOTAL RATHER THAN `!== null`.
  //
  // Three different absences reach this line and all three must render the same
  // nothing. `null` is the pasted-token path, which is handed a token and a
  // channel and is never told a name. An empty or blank column is the same
  // absence wearing a different shape — prod holds every value ever written,
  // not the one the type declares (D5). And ABSENT ENTIRELY is reachable
  // despite the required prop: a payload parsed from JSON that predates the
  // field, and any caller outside this typecheck, hand `undefined`. A
  // `=== null` test lets that one through to `.trim()` and takes the whole
  // delivery step down with it, which is a worse outcome than the missing
  // sentence this exists to add.
  const named = props.slackWorkspaceName;
  const workspaceName = typeof named === "string" && named.trim() !== "" ? named : null;

  const listUnavailable = picking && channels === null && failure !== null;
  const listEmpty = picking && noChannelsVisible(channels);

  // The two list states share ONE mechanism and not one sentence: asking again
  // is the whole of the fix for both, and what the founder has to do first is
  // different. `retry()` branches on this; `card()` branches on `listEmpty`.
  const relistable = listUnavailable || listEmpty;
  const retryable = relistable || (outcome !== null && !outcome.ok && outcome.retryable);

  // AD-7, and the reason nothing is cached: a founder told to pick a
  // destination very often goes and MAKES one first, and a stored list refuses
  // the only channel they actually want with no error and no way to refresh.
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

  function changeField(id: string) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.currentTarget.value;
      setValues((current) => ({ ...current, [id]: next }));
    };
  }

  function renderField(field: FieldDescriptor): ReactNode {
    const shared = {
      label: field.label,
      description: field.helper,
      placeholder: field.placeholder ?? undefined,
      value: values[field.id] ?? "",
      onChange: changeField(field.id),
      disabled: locked,
    };

    return field.secret ? (
      <PasswordInput key={field.id} {...shared} />
    ) : (
      <TextInput key={field.id} {...shared} />
    );
  }

  /**
   * POST, then render whatever came back — a refusal, or the post's own
   * outcome — and REPORT WHAT IT WAS rather than whether it went well.
   *
   * IT ASKS FOR NO REFRESH OF ITS OWN. The two callers refresh on different
   * facts: the test post on the step being settled, the channel call on the
   * address having landed. A refresh decided in here would have to be one of
   * those two, and the other caller would then either miss it or fire a second.
   */
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

  /** The post itself, which is the only half a retry repeats. */
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

    // A workspace and no address. One call attaches the chosen channel and
    // posts through it, so the click budget pays for one press either way.
    //
    // THE ADDRESS LANDING IS WHAT MOVES THIS CARD ON, NOT THE POST SUCCEEDING.
    // `channelAddressLanded` says which, and the refresh is unconditional on it
    // because the server has already resolved the step: `slackConnected` — and
    // therefore step 3 being done — derives from the stored channel existing,
    // not from a message having arrived (`lib/first-run/status.ts`). Without the
    // refresh the client sits on its own stale `channelId: null` and every later
    // press meets the once-only guard's 409 instead.
    if (workspaceAttached) {
      const answer = await sendTo(FIRST_RUN_API.slackChannel, { channelId: choice ?? "" });

      if (channelAddressLanded(answer)) {
        setChannelNow(true);
        router.refresh();
      }
      setPending(false);
      return;
    }

    const attached = await postJson(FIRST_RUN_API.slackConnect, {
      botToken: values[BOT_TOKEN] ?? "",
      channelId: values[CHANNEL_ID] ?? "",
    });

    if (attached === null || !attached.ok) {
      setPending(false);
      setFailure(readRefusal(attached?.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
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

    // The list never arrived, or it arrived empty and the founder has since gone
    // and invited the bot. Asking for it again is the whole retry either way —
    // there is nothing to post through until something comes back.
    //
    // THE OLD ANSWER GOES BACK TO "WE DO NOT KNOW" FIRST. Without that, a second
    // attempt that fails outright would leave last attempt's "your workspace has
    // no channels" on screen beside a network failure — a claim about the
    // workspace made from an answer we no longer have.
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

    const answer = await postJson(FIRST_RUN_API.slackSkip, {});
    setPending(false);

    if (answer === null || !answer.ok) {
      setFailure(readRefusal(answer?.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
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
    return <Stack gap="sm">{step.fields.map((field) => renderField(field))}</Stack>;
  }

  /**
   * Which card this founder is looking at.
   *
   * ###########################################################################
   * # THE INVARIANT: THE PASTED-TOKEN FORM MAY NEVER RENDER ON AN ORGANIZATION
   * # THAT ALREADY HAS A WORKSPACE ATTACHED. The branch below is how that is
   * # kept, and anybody adding a fifth state has to keep it too.
   * #
   * # It is written as `workspaceAttached` rather than as the state it was
   * # found in, so the form is unreachable from an attached organization by
   * # SHAPE rather than by a condition somebody has to get right. A founder
   * # here has already consented, or already pasted a token; asking for a bot
   * # token they never had is asking for the one thing that cannot help, and a
   * # second connect lands on the partial unique index rather than on anything
   * # useful.
   * #
   * # THE STATE IT WAS FOUND IN: consent completed, a channel picked, the
   * # attach committed, and the test post failed. `marksStepDone` is false on
   * # every failure, so nothing refreshed, and the card fell through the picker
   * # (a channel is attached) and past the "Add to Slack" fallback (a workspace
   * # is attached) to the pasted-token form. It is not exotic — picking a public
   * # channel the bot has not joined fails on the test post with
   * # `not_in_channel` (`lib/slack/channels.ts`), which is not retryable, so
   * # there was no Retry, no picker, and two inputs asking for a token they
   * # never had.
   * #
   * # THERE IS NO CARD BODY IN THIS STATE, AND NO RE-PICK CONTROL. The address
   * # is stamped and `attachChannel` never moves a chosen one (D12), so a "pick
   * # a different channel" button would post into the 409 forever — the button
   * # that can never work, which is what the header refuses on the post
   * # failures. What the founder has is what the action row already gives every
   * # state: the send button, which now re-posts through the stored channel and
   * # succeeds the moment the bot is invited to it, and the skip. Both live
   * # OUTSIDE this function precisely so a card changing shape cannot take them
   * # with it.
   * ###########################################################################
   */
  function card(): ReactNode {
    if (settled) {
      return null;
    }

    if (picking) {
      return (
        <ChannelPicker channels={channels} value={choice} onChange={setChoice} disabled={locked} />
      );
    }

    if (workspaceAttached) {
      return null;
    }

    // The fallback, and it is folded rather than absent. A self-hoster whose
    // workspace has its own app still needs the token form here, and a founder
    // who has never made one is pointed at the button instead — which is why
    // the disclosure says what pressing it gives you.
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
      {/* What the trip out to Slack settled on, said before anything else on
          the card — it is the answer to the question the founder came back
          with, and three of the six outcomes are not faults. */}
      {notice === null ? null : (
        <Text size="sm" c={notice.unexpected ? "stamp.4" : "dimmed"}>
          {notice.sentence}
        </Text>
      )}

      {/* WHICH WORKSPACE, DIRECTLY ABOVE THE PICKER — the one place a founder
          back from a consent screen is looking, and the one moment the answer
          changes what they do next. Somebody with two workspaces picking a
          channel in the wrong one finds out when what we find arrives somewhere
          nobody reads.

          Gated on `picking` rather than on the name alone: once a channel is
          chosen the workspace is settled and repeating it is noise. Gated on
          `workspaceName` rather than on `props.slackWorkspaceName` so the
          pasted-token path — which is never told a name — renders NOTHING here
          instead of a sentence with an empty hole in it. */}
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

      {/* FR-O14. Derived from a resolved step state, which is itself derived
          from the persisted ABSENCE of a connection — so it survives a reload
          by construction, and a workspace that later connects stops seeing it
          without anybody clearing a flag. */}
      {view.state === "skipped" ? (
        <Text size="sm" c="dimmed">
          {ONBOARDING_MESSAGES.slackSkippedNotice}
        </Text>
      ) : null}

      {settled || !view.interactive ? null : (
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
        </Group>
      )}
    </Stack>
  );
}
