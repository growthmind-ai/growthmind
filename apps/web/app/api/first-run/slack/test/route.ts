// POST /api/first-run/slack/test — the test message, which is also the
// announcement (O-008, FR-O11, FR-O13, EC-O1, AD-16, AD-20).
//
// ###########################################################################
// # D8: A FAILED POST DOES NOT FAIL THE STEP, AND DOES NOT FAIL THE FLOW.
// #
// # This answers 200 carrying a FAILURE OUTCOME rather than a 5xx. UX Flow D
// # is explicit: "in all four cases, setup is not broken." The step is not
// # done — a failed post proved nothing about the connection, and claiming
// # otherwise would be a fake confirmation — and it is also not an error state
// # that blocks the sequence: "Skip for now" is still there and still reaches
// # step five. The connection row survives, and the status route still
// # answers.
// #
// # `marksStepDone` and `retryable` are DERIVED, never hand-set here.
// # `describeTestPostOutcome` builds both from the shipped
// # `POST_FAILURE_MESSAGES` and `isRetryablePostFailure`, so a code added to
// # that enum later inherits the right answer instead of falling through a
// # local default — and a founder is never left pressing a button that can
// # never work.
// ###########################################################################
//
// ── FR-O13: THE CHANNEL COMES FROM THE ROW, NEVER FROM THE CALLER ───────────
//
// This route's declared input is NONE. A caller that could name a channel
// could post this organization's announcement into a channel it does not own,
// so the address is read off the stored `slack_connections` row — and the
// schema is a `z.strictObject({})`, which refuses one sent anyway rather than
// accepting it and quietly dropping it.
//
// ── THE BOT TOKEN IS NOT IN SCOPE IN THIS FILE ──────────────────────────────
//
// The poster arrives already bound to this organization's credential, opened
// once in the composition root (`@/lib/first-run/deps`). No handler names
// `openCredentialForOrg`, nothing here holds a decrypted token, and the port
// is the shipped `DeliveryPoster` rather than a second one built for this step
// (AD-20, FR-O11's "no new poster").
import {
  createSlackConnectionsRepo,
  ensureProject,
  findUserNameById,
  isDeliveryTarget,
} from "@growthmind/db";
import {
  describeTestPostOutcome,
  firstRunSlackTestInputSchema,
  POST_FAILURE_MESSAGES,
} from "@growthmind/shared";

import { resolveFirstRunDeps, type FirstRunRouteDeps } from "@/lib/first-run/deps";
import { readRequestBody, refuseBody, requireTenant } from "@/lib/first-run/gate";
import {
  CHANNEL_UNAVAILABLE,
  NO_CHANNEL_CHOSEN,
  NO_CHANNEL_CONNECTED,
  refusalResponse,
} from "@/lib/first-run/refusals";
import { buildTestPostMessage } from "@/lib/first-run/slack-test-message";

export const dynamic = "force-dynamic";

export const inputSchema = firstRunSlackTestInputSchema;

export async function handle(request: Request, deps: FirstRunRouteDeps): Promise<Response> {
  const gate = await requireTenant(deps);
  if (!gate.ok) return gate.response;

  const parsed = inputSchema.safeParse(await readRequestBody(request));
  if (!parsed.success) return refuseBody(parsed.error);

  await ensureProject(deps.db, gate.ctx);

  // ORG-SCOPED. Any member can send the test message, and every member sees
  // the same connection — the read is keyed on the organization and never on
  // whoever connected it.
  const connection = await createSlackConnectionsRepo(deps.db, gate.ctx).getActiveForOrg();
  if (connection === null) {
    return refusalResponse(NO_CHANNEL_CONNECTED);
  }

  // AD-4: THE ROW EXISTS AND THERE IS STILL NOWHERE TO POST. Since the OAuth
  // path stores a bot token before a channel is chosen, `getActiveForOrg`
  // returns a real connection during the whole mid-OAuth window — so the refusal
  // above never fires for it, and without this one the address handed to the
  // poster below is a null that interpolates into the four characters "null".
  // The guard is the same predicate the delivery tick consults, and its type
  // narrowing is what lets both reads below stay plain string reads.
  if (!isDeliveryTarget(connection)) {
    return refusalResponse(NO_CHANNEL_CHOSEN);
  }

  // "Nothing is connected" and "we cannot open what is connected" are
  // different mistakes with different next actions, and a founder told the
  // wrong one goes and does work that changes nothing.
  const poster = deps.poster ?? (await deps.posterFor?.(gate.ctx)) ?? null;
  if (poster === null) {
    return refusalResponse(CHANNEL_UNAVAILABLE);
  }

  // ATTRIBUTION, off the row rather than off the session: a teammate can send
  // the test, and telling the channel that they connected it would be false.
  const connectedByName =
    connection.connectedByUserId === null
      ? null
      : await findUserNameById(deps.db, connection.connectedByUserId);

  const result = await poster.post(
    buildTestPostMessage({
      channelId: connection.channelId,
      workspaceName: gate.ctx.organizationName,
      connectedByName,
    }),
  );

  const outcome = describeTestPostOutcome({ result, channelId: connection.channelId });

  return Response.json({
    ok: result.ok,
    // The SHIPPED sentence for the code, read from the one table rather than
    // echoed from the poster's own `message`. The port's contract already says
    // the vendor's text never reaches it, and reading the table rather than
    // trusting that is the same belt-and-braces the connect boundary applies.
    code: result.ok ? null : result.code,
    message: result.ok ? null : POST_FAILURE_MESSAGES[result.code],
    // The onboarding clause on top of it — the thing a founder cannot work out
    // on their own, such as "trying again will not help".
    sentence: outcome.sentence,
    retryable: outcome.retryable,
    marksStepDone: outcome.marksStepDone,
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, resolveFirstRunDeps());
}
