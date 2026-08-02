"use client";

// STEP 3 — SLACK, AND THE SKIP THAT IS A REAL ANSWER
// (O-008, AD-4, AD-6, AD-7, FR-O11, FR-O13, FR-O14, UX Checklist rows 12-16
// and Flow D).
//
// ###########################################################################
// # THREE CARDS, ONE COMPONENT, AND THE BRANCH IS A SERVER-COMPUTED BOOLEAN.
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
// # answer rather than forming a second one. The one retry this form adds of
// # its own is the channel list, because a list that did not arrive is exactly
// # the failure a second press does fix.
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

interface ConnectSlackFormProps {
  readonly step: WorkStep;
  readonly view: StepView;
  /** FR-O13: read from the stored row. `null` until a channel is attached. */
  readonly channelId: string | null;
  /** AD-4 row 4: EXISTENCE, not address. Never re-derived from `channelId`. */
  readonly slackWorkspaceAttached: boolean;
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

  const listUnavailable = picking && channels === null && failure !== null;
  const retryable = listUnavailable || (outcome !== null && !outcome.ok && outcome.retryable);

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
   * outcome. `true` means the route got as far as posting, which on the channel
   * path also means the attach stands (D8: a failed test post does not roll it
   * back).
   */
  async function sendTo(path: string, body: unknown): Promise<boolean> {
    const answer = await postJson(path, body);

    if (answer === null) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return false;
    }

    const read = readTestPostAnswer(answer.body);
    if (read === null) {
      setFailure(readRefusal(answer.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
      return false;
    }

    setOutcome(read);
    if (read.marksStepDone) {
      router.refresh();
    }
    return true;
  }

  /** The post itself, which is the only half a retry repeats. */
  async function post(): Promise<void> {
    await sendTo(FIRST_RUN_API.slackTest, {});
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
    if (workspaceAttached) {
      if (await sendTo(FIRST_RUN_API.slackChannel, { channelId: choice ?? "" })) {
        setChannelNow(true);
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

    // The list never arrived. Asking for it again is the whole retry — there is
    // nothing to post through until it does.
    if (listUnavailable) {
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

  /** Which of the three cards this founder is looking at. */
  function card(): ReactNode {
    if (settled) {
      return null;
    }

    if (picking) {
      return (
        <Select
          label={ONBOARDING_MESSAGES.channelLabel}
          description={ONBOARDING_MESSAGES.slackChannelPickPrompt}
          data={(channels ?? []).map((channel) => ({ value: channel.id, label: channel.name }))}
          value={choice}
          onChange={setChoice}
          disabled={locked || channels === null}
          searchable
        />
      );
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
