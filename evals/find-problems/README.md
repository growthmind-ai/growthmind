# find-problems

One question, and the product rests on it: **can a model find the product problems a growth engineer would find, from real recorded sessions?**

Not "can it summarise a session" — the product already does that, and `packages/adapters/src/model/narrator.ts` is deliberately a renderer rather than a judge. This asks the harder thing. Model-driven personas are turned loose on our own app, their sessions are recorded with real rrweb and pushed through the **production** replay path, and a separate analysis pass is asked what is wrong with the product. Its answer is then scored against a set of problems a human confirmed are really there and which the pass never sees.

A negative result here is worth as much as a positive one, provided it is attributed. Most of the design below exists to keep that attribution possible.

## Running it

Everything runs from the **repo root**, because bun reads `.env` from the current working directory and not from the repo root. Run any of these from `evals/find-problems/` and `AWS_BEARER_TOKEN_BEDROCK` arrives `undefined`.

```bash
bun evals/find-problems/src/run.ts all                       # record, analyse, score
bun evals/find-problems/src/run.ts record --run my-run        # record only
bun evals/find-problems/src/run.ts corpus  --run my-run       # rebuild the analyser's input
bun evals/find-problems/src/run.ts analyse --run my-run       # ask the model, same corpus
bun evals/find-problems/src/run.ts score   --run my-run       # grade against the key
```

Splitting the phases is the point: recording four personas costs minutes and real tokens, so an analyser prompt or a scorer change is re-run against a corpus already on disk. `--persona <id>` records one persona. Output lands in `runs/<run-id>/`, which is gitignored — recordings of our own app with real sign-ups in them are not artefacts to commit.

### A missing credential must never look like a model that found nothing

`readEvalEnv()` throws `MissingCredentialError` naming the variable and the working-directory trap. That is deliberate: the whole output of this harness is a judgement about model capability, and a silent credential failure would read as "the model found nothing". A failed read is not an empty state.

### The origin is a parameter, and `localhost` will probably not work

```bash
bun evals/find-problems/src/run.ts all --base-url https://your-tunnel.example.dev
# or set EVAL_BASE_URL in .env
```

Better Auth rejects any origin that is not `BETTER_AUTH_URL`. When the dev server is reached through a tunnel — as it is whenever someone is testing Slack OAuth — a sign-in POST from `http://localhost:3000` comes back **403 `INVALID_ORIGIN`**, and the sign-in form reports it as _"Couldn't reach the server — check your connection and try again."_ Every persona then dead-ends on the sign-in page for an infrastructure reason that looks exactly like a product problem.

The scenario file keeps `localhost` so a clean clone works, and the tunnel host lives in `.env` rather than in a committed file, because this repo is public.

### Models

| Lane     | Default                                                                     | Override              |
| -------- | --------------------------------------------------------------------------- | --------------------- |
| Personas | `DEFAULT_COLDSTART_MODEL` (Haiku 4.5) — many calls, one small decision each | `EVAL_PERSONA_MODEL`  |
| Analyser | `eu.anthropic.claude-sonnet-4-5-20250929-v1:0`                              | `EVAL_ANALYSER_MODEL` |
| Judge    | same as the analyser                                                        | `EVAL_JUDGE_MODEL`    |

Both ids were confirmed reachable with the Bedrock key in `.env` at `AWS_REGION=eu-west-2`. The `eu.` prefix is load-bearing for the reason `packages/adapters/src/model/constants.ts` gives: a Bedrock API key is scoped to one region and a model id from the wrong region group fails at call time.

## Why Node drives the browser and bun does everything else

bun cannot launch Playwright on Windows. Its `child_process` does not wire the stdio file descriptors Playwright's pipe transport needs, so a bun-hosted launch hangs at the CDP handshake; connecting over CDP instead fails too, because bun's WebSocket client cannot complete the upgrade. Under Node the same launch takes about three and a half seconds.

So the browser lives in a Node subprocess (`driver.mjs`, `browser.mjs`) and everything downstream lives in bun. They speak newline-delimited JSON over stdio: the driver emits an observation, bun answers with one action, the driver performs it and emits the next observation. `driver.mjs` writes protocol lines to stdout and nothing else — diagnostics go to stderr, because a stray `console.log` would corrupt the stream.

That split is not a workaround dressed up as architecture. It keeps the persona brain, the analyser and the scorer in typed TypeScript on this repo's own model lane, tested with `bun test`, while Playwright stays in the only host that can start it.

## Why personas are not scripted

A scripted persona clicks what the script says and never gets lost, so it cannot produce genuine struggle — you would be planting the rage-click rather than earning it.

A persona here gets an intent in plain English ("you heard about this tool and want to get it watching your product") and nothing else. Each turn it receives a screenshot plus a numbered list of the visible interactive elements with their accessible names, and returns a structured choice: element index, action, optional text, what it is thinking, and whether it feels stuck. Index selection beats raw coordinates for reliability; the action is then executed as a real Playwright click, so rrweb sees real pointer events and a rage-click would be a real one.

**Abandonment is a first-class outcome.** A persona that decides it cannot work out what to do chooses `give_up` and says why, and that is the single most valuable session the harness can record — so it is an outcome with a recorded reason rather than a step cap running out. Personas vary by patience and technical confidence, and several run per scenario.

`__tests__/a-persona-is-never-told-where-to-click.test.ts` asserts no persona's intent and no part of the system prompt names a route, a control, or a vendor. A hint there would quietly convert the whole exercise into a scripted walk.

## Why the answer key is held out

If the analyser is told what to find, the exercise measures nothing. So a scenario is two files:

- `scenario.json` — start URL, viewport, personas and their intents. This is what a run loads.
- `answers.json` — the problems genuinely present, written as an answer key. Only the scorer reads it.

The separation is enforced in code, not by convention:

- `loadScenario()` reads `scenario.json` and its schema is `.strict()`, so a key pasted into the scenario fails to parse rather than reaching a prompt.
- `loadAnswerKey()` lives in `src/score/answer-key.ts` and is the only reader of `answers.json` in the package. Nothing on the analyser's path imports it.
- `corpusAnalysisInputSchema` is `.strict()`, so a key spread into the analyser's input is rejected at the boundary rather than trusted to a type.
- `__tests__/answer-key-is-unreachable-from-the-analyser.test.ts` asserts all of it, including that no key title or statement appears in the prompt actually sent.

**The key is derived from what the personas hit, never from what we imagine they would hit.** Every entry in `answers.json` carries an `observedIn` field naming the sessions and beats that justify it. An entry nobody can point at is not an answer, it is a wish.

## Why this lane is allowed to judge

The product's own model call sites are explicit that they are renderers and not judges, and `guardModelText` in `packages/core/src/summary/output-schema.ts` actively rejects causal language — SAC-7 refuses "because", "caused", "due to", "therefore". Those guards protect **delivered findings**, where an invented cause is a lie told to a customer.

This lane measures whether judgement is possible at all, which is the one thing those guards forbid. So it does not import `guardModelText`, does not route through it, and never writes to the findings tables. It is a separate lane, decoupled from the deterministic pipeline, and it must stay that way.

Two disciplines survive the change of lane, because they are what makes an answer usable:

- **Every claim states what was seen and out of how many.** The denominator is supplied by the harness rather than by the model, so `sessionsTotal` is structurally present on every claim and a bare "3 sessions" cannot be produced.
- **Every claim cites the sessions and beats it rests on.** `assessProblems` checks each citation against the corpus and marks a claim `unsupported` when none of them can be found. An uncited claim is **marked, never dropped** — deleting it would hide a result about the model.

## Scoring

The scorer runs a cheap deterministic pass first, matching a key problem's `matchAny` signals against the proposal text, then asks a model judge only about the rows a string cannot settle. Every row in the report says which of the two settled it, because a judged match is a weaker claim than a matched one and the reader is entitled to know which they are reading.

It reports, always with denominators: planted problems found and missed; proposals that match no planted problem and cite nothing checkable (**invented**); proposals that match no planted problem but do cite real beats (**beyond the key** — a real observation the key does not list, which is not the same as being wrong); claims marked unsupported; claims counting more sessions than the corpus holds; and whether each recommendation is actionable, which always needs the judge.

## Known limits of the evidence

Read these before trusting a number out of this harness.

- **The transcript carries no error text.** `renderTranscript` renders element selectors — `clicked button[label=Sign in].mantine-focus-auto` — and never what the screen said back. A persona that reads "That email and password don't match" and reacts to it leaves a transcript in which the message does not appear, so the analyser must infer the cause of every failure. This is the largest single constraint on what the pass can find, and it is a fact about the production replay path rather than about the model.
- **rrweb emits no Meta event for a client-side route change**, so `transcript.pages` under-reports badly on an App Router product. Sessions therefore also carry `urlTrail`, which is the page-view stream a real customer's install would have alongside the recording.
- **A cross-origin navigation restarts the recording.** A persona sent to `slack.com` by the Slack step loses the in-app portion of its recording entirely.
- **Console errors are attributed, and one signature is known to be ours.** Run the dev server for eval runs with `NEXT_PUBLIC_RRWEB_PUBLIC_KEY` unset, so the app's own recorder from `apps/web/lib/rrweb-capture.ts` never starts and only the harness's does — two recorders on one DOM observe each other's mutations and each adds noise. `Maximum call stack size exceeded` is then allowlisted as `harness` because it was measured to ours: 0 errors from the app's recorder alone, 0 from the harness's injection on a trivial page, exactly 2 from the harness's injection on our sign-in DOM, unchanged by `inlineStylesheet`, `recordCanvas` and `collectFonts`, and with recording unaffected.

  It is **attributed, not suppressed** — kept in the run output, excluded from the analyser's evidence — because a list that deleted information could not tell anyone when the noise became real. Two guards keep the allowlist honest: a third occurrence in a session fails the run (`HarnessNoiseMovedError` — the artefact has moved and the allowlist is now lying), and a test asserts the list has exactly one entry, so it cannot accrete into the suppression list this deliberately is not. Everything else reaches the analyser untouched. **The product is clean here, so there is no crash to find on the sign-in page** — an analyser that reports one is producing a false positive, and the scorer counts it as invented.

  Both the guard and the attribution are **scoped to the product's own origin**, and that scoping is load-bearing rather than tidiness. The injection follows the persona off-site, so a session sent to `slack.com` by the Slack step recorded fourteen occurrences on Slack's much heavier DOM — the guard caught it on the first run. Without the origin scope, another company's console errors would have been fed to the analyser as evidence about ours.

- **Personas create real accounts in the local database.** Signing up _is_ the activation funnel and is the most valuable thing to observe, so it is not skipped by seeding a user into Postgres. Emails carry the run id to stay unique.

## Layout

```
browser.mjs        rrweb injection, page observation      (Node)
driver.mjs         the stdio protocol and the browser     (Node)
recorder.mjs       plan-driven recording, no model        (Node)
smoke.ts           events through the production schema and transcript
src/env.ts         credentials, loudly
src/protocol.ts    the driver contract, as Zod
src/persona/       the brain that decides its own next click
src/session/       personas driven, recordings summarised
src/analyse/       the pass under test, and citation support
src/score/         the key, the match, the judge, the card
src/scenarios/     scenario.json and the held-out answers.json
__tests__/         named after the rule each protects
```
