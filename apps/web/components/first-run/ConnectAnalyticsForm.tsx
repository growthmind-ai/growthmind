"use client";

// STEP 2 — THE ONE CONNECTION THE PRODUCT CANNOT WORK WITHOUT
// (O-008, FR-O5, FR-O6, AD-1, AD-2, AD-3, UX Checklist rows 5-8, Flows C and F).
//
// ###########################################################################
// # ONE VISIBLE FIELD. THE HUNT IS GONE.
// #
// # This card used to open with two fields and a disclosure: the vendor's
// # project number, the personal key, and a question about which region you
// # were on. Two of those three were work the product could do for the founder,
// # and made them leave the product to do it — the number lives on the vendor's
// # settings page, and the region is something we can simply try.
// #
// # So: paste the key, press once. We ask the vendor which projects that key
// # can read, walking both hosted regions ourselves.
// #   ONE project  -> connected on the spot, AND WE SAY WHICH ONE. A product
// #                   that decides for somebody without telling them has taken
// #                   the decision away; the sentence names the project and
// #                   names the way back out.
// #   MANY         -> the list, in the order discovery already put it in.
// #                   Picking is the connect.
// #   NONE         -> the shipped refusal. A chooser with nothing in it is a
// #                   screen asking somebody to choose nothing.
// #
// # THE ADDRESS QUESTION IS EARNED (AD-2). The self-host field is not on this
// # card at first render, and for a founder on either hosted region it never
// # appears at all. It is revealed once a region walk has come back refused —
// # at which point it has stopped being a question every founder answers and
// # become a branch for the ones it is true for. There is no second disclosure
// # for it to be rendered beside.
// ###########################################################################
//
// ###########################################################################
// # THE FIELDS ARE DATA; THE ACTIONS ARE NOT.
// #
// # Every field on this form — its label, its helper, whether it is masked,
// # whether it starts folded, what it is prefilled with, and WHICH REFUSALS IT
// # IS THE SUBJECT OF — comes off the step descriptor. That last one is the
// # wire that makes UX rows 6 and 7 one mechanism instead of two: a refusal
// # names a code, the descriptor says which field that code is about, and this
// # form moves focus there and unfolds it if it was hidden. A refusal naming a
// # field the founder cannot see is a dead end.
// #
// # The descriptor holds NO field this form declines to render, which is why
// # `project_not_found` — a code that is nobody's field now — renders as the
// # card's own sentence rather than as an error on an input nobody can see.
// #
// # The ACTIONS are wired here rather than read off the descriptor, because an
// # action is a handler and a handler cannot be data. Their labels still come
// # from the one copy home, and this file authors no sentence of its own.
// #
// # PROGRESS HAS ONE LOCUS: the control that was pressed, with a verb on it. No
// # spinner overlay, no skeleton, no second signal anywhere on the row (T1).
// #
// # AND A REJECTED SECRET IS NEVER RE-SUBMITTED SILENTLY. On any refusal every
// # masked field is cleared and every visible value is preserved, so the
// # founder retypes only the thing that was wrong.
// ###########################################################################
import { Button, Collapse, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useRouter } from "next/navigation";
import { useRef, useState, type ChangeEvent, type ReactNode } from "react";

import {
  ONBOARDING_MESSAGES,
  type FieldDescriptor,
  type StepView,
  type WorkStep,
} from "@growthmind/shared";

import { tapTargetStyle } from "@/components/ui/tap-target";

import {
  FIRST_RUN_API,
  postJson,
  readDiscovery,
  readRefusal,
  type DiscoveredProjectView,
  type DiscoveryAnswer,
  type ResponseRefusal,
} from "./api";
import { initialValues, offendingField, withSecretsCleared, type FieldValues } from "./form-fields";

/**
 * The two field ids, named once.
 *
 * The routes use the vendor's own vocabulary (`host`, `personalApiKey`) and the
 * form uses the founder's ("Region address"). The mapping between them is the
 * kind of thing that rots quietly, so it is written in one place and read from
 * constants. There is no third id: the project number is discovered now, and a
 * constant for it would be the first thing a rebuild reached for.
 */
const PERSONAL_KEY = "personalKey";
const SELF_HOST_ADDRESS = "regionAddress";

/** What it takes to attach one discovered project. See `attach` below. */
interface AttachInput {
  /** The address the walk settled on, never re-derived. */
  readonly host: string;
  readonly project: DiscoveredProjectView;
  /**
   * The sentence for a project chosen FOR the founder, and `null` when they
   * chose it themselves — telling somebody what they just pressed is noise, and
   * telling them what we pressed on their behalf is not.
   */
  readonly announcement: string | null;
}

interface ConnectAnalyticsFormProps {
  readonly step: WorkStep;
  readonly view: StepView;
  /** The shipped sentence for this connection's state. Never authored here. */
  readonly connectionMessage: string;
}

export function ConnectAnalyticsForm(props: ConnectAnalyticsFormProps) {
  const { step, view, connectionMessage } = props;
  const router = useRouter();

  const [values, setValues] = useState<FieldValues>(() => initialValues(step.fields));
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<ResponseRefusal | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState(false);
  // What the key bought, held as ONE value so a host can never be paired with
  // another walk's projects (D11). Non-null only while a choice is outstanding.
  const [discovery, setDiscovery] = useState<DiscoveryAnswer | null>(null);
  // Which option is being attached, so the spinner sits on the one that was
  // pressed rather than on every row of the list.
  const [choosing, setChoosing] = useState<string | null>(null);
  // Set the moment a region walk comes back refused. This is the whole of
  // "earned": it is observed here, held here, and read nowhere else.
  const [addressEarned, setAddressEarned] = useState(false);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const attached = view.state === "done";
  const locked = pending || !view.interactive;
  const offender = offendingField(step.fields, refusal === null ? null : refusal.code);

  // The reveal is belt AND braces. `addressEarned` is the designed trigger, and
  // a refusal that is ABOUT the address reveals it too — so the guarantee that
  // no refusal ever names an invisible field holds even if the bookkeeping
  // above is ever changed. The two conditions are independent on purpose.
  const addressOffended = offender !== null && offender.folded;
  const addressOffered = addressEarned || addressOffended;

  // UX row 7: the disclosure AUTO-EXPANDS when the refusal is about the
  // address. Derived rather than pushed into state, so the frame that first
  // renders the sentence is already the frame that shows the field it names —
  // there is no window in which the founder is told to check something they
  // cannot see.
  const expanded = unfolded || addressOffended;

  function rememberInput(id: string) {
    return (node: HTMLInputElement | null) => {
      inputs.current[id] = node;
    };
  }

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
      error: offender?.id === field.id ? refusal?.message : undefined,
    };

    return field.secret ? (
      <PasswordInput key={field.id} ref={rememberInput(field.id)} {...shared} />
    ) : (
      <TextInput key={field.id} ref={rememberInput(field.id)} {...shared} />
    );
  }

  function refuse(answer: ResponseRefusal) {
    setRefusal(answer);
    setValues((current) => withSecretsCleared(current, step.fields));
    // The list was bought with the key that was just cleared, so it goes with
    // it. Leaving it up would offer a pick that can only be sent with a
    // credential the founder no longer has in the field.
    setDiscovery(null);
    setChoosing(null);

    const target = offendingField(step.fields, answer.code);
    if (target === null) {
      return;
    }
    // Deferred by one frame so the focus lands AFTER the disclosure above has
    // expanded. A folded field is hidden, and a hidden element cannot take
    // focus — the sequence has to be expand, then focus, in that order.
    requestAnimationFrame(() => inputs.current[target.id]?.focus());
  }

  /**
   * The second half of both paths: attach the project the founder ended up
   * with, at the host the walk settled on.
   */
  async function attach(input: AttachInput) {
    const { host, project, announcement } = input;

    const answer = await postJson(FIRST_RUN_API.analyticsConnect, {
      host,
      sourceProjectId: project.sourceProjectId,
      personalApiKey: values[PERSONAL_KEY] ?? "",
    });
    setPending(false);
    setChoosing(null);

    if (answer === null) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }
    if (answer.ok) {
      setDiscovery(null);
      setNotice(announcement);
      // The step's new state is a PERSISTED fact, so it is re-read rather than
      // guessed at here — a reload has to land on the same screen (D4).
      router.refresh();
      return;
    }

    const found = readRefusal(answer.body);
    if (found === null) {
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }
    refuse(found);
  }

  async function connect() {
    setPending(true);
    setRefusal(null);
    setFailure(null);
    setNotice(null);
    setDiscovery(null);

    // Empty means "walk the hosted regions"; typed means "I have my own
    // address". The field is not prefilled precisely so that an untouched form
    // takes the walk — a value sitting there would send us to one address and
    // skip the walk the founder still needs.
    const address = (values[SELF_HOST_ADDRESS] ?? "").trim();
    const personalApiKey = values[PERSONAL_KEY] ?? "";
    const walked = address === "";

    const answer = await postJson(
      FIRST_RUN_API.analyticsDiscover,
      walked ? { personalApiKey } : { personalApiKey, host: address },
    );

    if (answer === null) {
      setPending(false);
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    if (!answer.ok) {
      setPending(false);
      // EARNED, HERE AND NOWHERE ELSE. Every hosted region has now answered and
      // none of them produced a list, which is the one situation in which
      // asking about an address of their own is a question we have earned. It
      // is set on ANY refusal from the walk rather than on a chosen few codes:
      // withholding the branch strands every self-hoster, offering it costs one
      // folded line, and a list of codes is a list that drifts (D9, D10).
      if (walked) {
        setAddressEarned(true);
      }

      const found = readRefusal(answer.body);
      if (found === null) {
        setFailure(ONBOARDING_MESSAGES.networkFailure);
        return;
      }
      refuse(found);
      return;
    }

    const found = readDiscovery(answer.body);
    if (found === null) {
      setPending(false);
      setFailure(ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    const [only] = found.projects;
    if (found.projects.length === 1 && only !== undefined) {
      // AD-3. Nothing is asked, and the sentence says which project we took and
      // how to undo it. `pending` stays true across both calls, so one press
      // reads as one act with one progress locus (T1).
      await attach({
        host: found.host,
        project: only,
        announcement: autoSelectedNotice(only.name),
      });
      return;
    }

    setPending(false);
    setDiscovery(found);
  }

  function choose(project: DiscoveredProjectView) {
    if (discovery === null) {
      return;
    }
    setPending(true);
    setChoosing(project.sourceProjectId);
    setRefusal(null);
    setFailure(null);
    setNotice(null);
    void attach({ host: discovery.host, project, announcement: null });
  }

  async function disconnect() {
    setPending(true);
    setRefusal(null);
    setFailure(null);

    const answer = await postJson(FIRST_RUN_API.analyticsDisconnect, {});
    setPending(false);

    if (answer === null || !answer.ok) {
      setFailure(readRefusal(answer?.body)?.message ?? ONBOARDING_MESSAGES.networkFailure);
      return;
    }

    // Org-wide, and it says so. A teammate pressing this must not find out
    // afterwards that they revoked it for everybody (UX Checklist row 28).
    setNotice(ONBOARDING_MESSAGES.disconnectConfirmation);
    router.refresh();
  }

  const visible = step.fields.filter((field) => !field.folded);
  const folded = step.fields.filter((field) => field.folded);

  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {connectionMessage}
      </Text>

      {attached || discovery === null ? null : (
        <Stack gap="xs">
          <Text size="sm">{ONBOARDING_MESSAGES.projectPickPrompt}</Text>

          {discovery.projects.map((project) => (
            <Button
              key={project.sourceProjectId}
              variant="default"
              justify="flex-start"
              onClick={() => choose(project)}
              loading={choosing === project.sourceProjectId}
              disabled={locked && choosing !== project.sourceProjectId}
              style={tapTargetStyle}
              w="100%"
            >
              {project.name}
            </Button>
          ))}
        </Stack>
      )}

      {attached || discovery !== null ? null : (
        <Stack gap="sm">
          {visible.map((field) => renderField(field))}

          {!addressOffered
            ? null
            : folded.map((field) => (
                <Stack key={field.id} gap={4}>
                  <Button
                    variant="subtle"
                    color="gray"
                    size="compact-sm"
                    onClick={() => setUnfolded((open) => !open)}
                    style={tapTargetStyle}
                  >
                    {field.disclosure}
                  </Button>
                  <Collapse expanded={expanded}>{renderField(field)}</Collapse>
                </Stack>
              ))}

          <Button
            onClick={() => void connect()}
            loading={pending}
            disabled={locked}
            style={tapTargetStyle}
            w={{ base: "100%", xs: "auto" }}
          >
            {pending ? ONBOARDING_MESSAGES.connecting : ONBOARDING_MESSAGES.connect}
          </Button>
        </Stack>
      )}

      {refusal === null || offender !== null ? null : (
        <Text size="sm" c="stamp.4">
          {refusal.message}
        </Text>
      )}

      {failure === null ? null : (
        <Text size="sm" c="stamp.4">
          {failure}
        </Text>
      )}

      {notice === null ? null : (
        <Text size="sm" c="dimmed">
          {notice}
        </Text>
      )}

      {attached && view.interactive ? (
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          onClick={() => void disconnect()}
          loading={pending}
          disabled={locked}
          style={tapTargetStyle}
          w={{ base: "100%", xs: "auto" }}
        >
          {ONBOARDING_MESSAGES.disconnect}
        </Button>
      ) : null}
    </Stack>
  );
}

/**
 * The one project's name, in the shipped sentence that names it.
 *
 * Kept out of the component body so the interpolation has one home and cannot
 * pick up a second spelling at a second call site.
 */
function autoSelectedNotice(project: string): string {
  return ONBOARDING_MESSAGES.projectAutoSelectedTemplate.replaceAll("{project}", project);
}
