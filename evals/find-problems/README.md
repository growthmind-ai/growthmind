# find-problems

One question, and the product rests on it: **can a model find the product problems a growth engineer would find, from real recorded sessions?**

Not "can it summarise a session" — the product already does that, and `packages/adapters/src/model/narrator.ts` is deliberately a renderer rather than a judge. This asks the harder thing. Model-driven personas are turned loose on our own app, their sessions are recorded with real rrweb and pushed through the **production** replay path, and a separate analysis pass is asked what is wrong with the product. Its answer is then scored against a set of problems a human confirmed are really there and which the pass never sees.

A negative result here is worth as much as a positive one, provided it is attributed. Most of the design below exists to keep that attribution possible.

## Running it

Once per machine, install the browser. `playwright-core` is deliberate — it never downloads one — so without this the recorder dies with `Executable doesn't exist at …ms-playwright…`:

```bash
bunx playwright install chromium
```

Everything else runs from the **repo root**, because bun reads `.env` from the current working directory and not from the repo root. Run any of these from `evals/find-problems/` and `AWS_BEARER_TOKEN_BEDROCK` arrives `undefined`.

```bash
bun evals/find-problems/src/run.ts all                       # record, analyse, score
bun evals/find-problems/src/run.ts record --run my-run        # record only
bun evals/find-problems/src/run.ts corpus  --run my-run       # rebuild the analyser's input
bun evals/find-problems/src/run.ts analyse --run my-run       # ask the model, same corpus
bun evals/find-problems/src/run.ts score   --run my-run       # grade against the key
```

Splitting the phases is the point: recording four personas costs minutes and real tokens, so an analyser prompt or a scorer change is re-run against a corpus already on disk. `--persona <id>` records one persona. Output lands in `runs/<run-id>/`, which is gitignored — recordings of our own app with real sign-ups in them are not artefacts to commit.

### Rebuilding one run's recordings into another run id

A change to the replay path is measured by putting the **same recordings** through it and comparing. `--from` does that without a browser, a tunnel or a model:

```bash
bun evals/find-problems/src/run.ts corpus  --run corpus-3-b --from corpus-3
bun evals/find-problems/src/run.ts analyse --run corpus-3-b
bun evals/find-problems/src/run.ts score   --run corpus-3-b
```

The new run gets its own manifest, marked `recordingsFrom`, pointing at the recordings where they already sit; nothing is copied and nothing is re-recorded. Re-recording would move the personas as well as the code, and there would be nothing left to attribute the difference to. A run id that already holds recordings of its own is refused rather than written over.

### Three arms, one variable each

Two things changed at once for `corpus-3`: the replay path started emitting what the screen said back, and the analyser started being handed the counts. A single rebuilt run would move both, and a better score would belong to neither. So there are three arms over the **same recordings** and the **same held-out key**:

| Arm   | Transcript              | Counts       | Isolates                                             |
| ----- | ----------------------- | ------------ | ---------------------------------------------------- |
| **A** | old (`corpus-3` as run) | not given    | the baseline                                         |
| **B** | new                     | **withheld** | what the replay-path work alone bought               |
| **C** | new                     | given        | what not asking a model to do arithmetic adds on top |

```bash
bun evals/find-problems/src/run.ts analyse --run corpus-3-b --from corpus-3 --counts-withheld
bun evals/find-problems/src/run.ts score   --run corpus-3-b

bun evals/find-problems/src/run.ts analyse --run corpus-3-c --from corpus-3
bun evals/find-problems/src/run.ts score   --run corpus-3-c
```

Arm A is `corpus-3` as it already stands; it needs nothing run against it.

B−A is the value of the transcript carrying what the screen said back; C−B is the value of the counts. Neither claim rests on the other.

`--counts-withheld` moves the prompt and nothing else. With the counts withheld the analyser is sent **word for word** what arm A was sent — same body, same system prompt minus the one line about the counts — and a test asserts that byte for byte against the prompt stored in `corpus-3`'s own `analysis.json`. The facts are still counted and the analysis is still scored against them, so "did it lead with the headline fact" is answered for every arm; that row is the measurement, not the instruction.

**The arm is written into the run's manifest at analyse time and printed at the top of `report.md`**, above the scorecard, because a scorecard whose conditions are not on its face gets quoted out of context eventually. A run analysed before arms were recorded says so rather than implying one. The report takes the conditions from the manifest, never from the flags of whoever is running `score`.

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

## Why the analyser is told the counts rather than asked for them

The first sentence a growth engineer writes about a set of sessions is a count — _nobody got through_ — and `corpus-3` proved a model will not write it. It proposed three problems and none of them was that none of the four sessions connected anything, which the key lists as high severity and the scorer counted as missed.

That is not a prompt to tune. **Counting is deterministic code's job**, and this repo already says so everywhere else: `packages/core/src/counts/measured-count.ts` owns the numbers in a delivered finding, and `summariser.ts` is told never to write one because "the numbers are added afterwards from verified data; any you write would be wrong". The eval was violating its own product's architecture by asking a model to notice a funnel fact.

So `src/facts/` counts the corpus itself, before the analyser is asked anything, and hands it the result as settled fact:

- **Every fact names the sessions it counts**, so a reader and the scorer can check it rather than trust it. A fact nobody can check is the thing this harness exists to avoid producing.
- **Every fact carries its denominator**, because the statement is built as `N of M` and cannot be built any other way.
- **Nothing in it is a threshold.** There is no minimum session count, no percentage floor and no similarity cut-off: a fact exists for every page reached, every outcome present and every thing the screen said back, whether one session or all of them saw it.

**What counts as connected is a definition, not a number**, and it is one line, in `src/facts/activation.ts`, carried with every count it decides and printed at the top of the run's `facts.json` and `report.md`:

> A session connected something when the screen said back that a connection was made — the analytics it can see, the Slack workspace, the coding assistant, or the product reporting itself as running. Reaching the setup page, filling its fields and pressing Connect are not connecting.

The markers are imported from `ONBOARDING_MESSAGES` rather than pasted, so a reworded screen cannot leave a stale string matching forever.

Their limit is the transcript's, and it is worth being exact about what that limit is, because it is the whole point of the exercise. **None of the four sessions in `corpus-3` connected anything** — that is a fact about what happened, and the personas' own traces confirm it: two pressed Connect and were told the request could not be read, one left for another company's login and never came back, one gave up on the sign-in page. What changed when the replay path started emitting what the screen said back is not that fact but its status: the claim became **observable from the record** rather than true-but-unevidenced. A corpus built before that reports every session as not connected because it can see no connection, and it happens to be right; after it, the same answer rests on the recording rather than on nobody having found evidence to the contrary. A harness whose numbers are right for the wrong reason has not measured anything, which is why the arms below separate the two.

The analyser keeps the job worth having, the why and the fix, and its prompt presents the counts as established — except on the arm where they are withheld, which is how what they were worth gets measured rather than assumed. The scorer checks two things back on every arm: whether the first problem proposed is the one the headline fact names, and whether any claim states a number that disagrees with a counted one. A claim may state the count or its complement — "0 of 4 connected" and "4 of 4 did not" are the same fact — and any other number disagrees with the record.

## Why the answer key is held out

If the analyser is told what to find, the exercise measures nothing. So a scenario is two files:

- `scenario.json` — start URL, viewport, personas and their intents. This is what a run loads.
- `answers.json` — the problems genuinely present, written as an answer key. Only the scorer reads it.

The separation is enforced in code, not by convention:

- `loadScenario()` reads `scenario.json` and its schema is `.strict()`, so a key pasted into the scenario fails to parse rather than reaching a prompt.
- `loadAnswerKey()` lives in `src/score/answer-key.ts` and is the only reader of `answers.json` in the package. Nothing on the analyser's path imports it, `src/facts/` included — the facts are counted from the corpus, and a fact that agreed with the key because it had read it would measure nothing at all.
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

It reports, always with denominators: whether the analyser led with the corpus's own headline fact, and how many of its claims disagree with a count the harness made; planted problems found and missed; proposals that match no planted problem and cite nothing checkable (**invented**); proposals that match no planted problem but do cite real beats (**beyond the key** — a real observation the key does not list, which is not the same as being wrong); claims marked unsupported; claims counting more sessions than the corpus holds; and whether each recommendation is actionable, which always needs the judge.

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
src/rebuild.ts     a new run id onto an existing run's recordings
src/persona/       the brain that decides its own next click
src/session/       personas driven, recordings summarised
src/facts/         the counts, made by code before the model is asked
src/analyse/       the pass under test, and citation support
src/score/         the key, the match, the judge, the card
src/scenarios/     scenario.json and the held-out answers.json
__tests__/         named after the rule each protects
```
