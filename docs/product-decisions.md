# Growthmind: Product Decisions

> Build a product people actually use, then use again. You cannot build a product that
> people want without understanding business data points like your ICP.
>
> These are commitments, not aspirations. The codebase is built against them; a change
> to this document is a product decision, not a docs edit.

## 1. Install and time to value

- Must install simply and get running very quickly. Onboarding can include a 5 to 10 second action on their own web app.
- Must produce a real finding within 24 hours of install. Put a number on it and hold yourself to it.
- Must not require the customer to define activation before they get value. Propose the activation definition from observed behaviour and let them correct it. Every onboarding tool on the market makes the customer define this first, and it is where they lose people.
- Must not require a tracking plan or taxonomy up front. Auto-instrument, name afterwards.
- Must not assume the customer has a feature flag system. Plenty of the target segment does not, so there needs to be a ship-and-measure path with a stated rollback.
- Read-only repo access must be sufficient for the core loop. Write is a mode, never a requirement.
- Must create packages for events and a plugin for the skills.
- Research the company's ICP, positioning and other important data points for growth.

## 2. Instrumentation and event model

- Events must be easily understandable, written in English as a description of what happened.
- Must tie every event to a line of code. No event the agent cannot point at.
- Must derive event meaning from the codebase, not from a config file. Code changes, meaning updates.
- Events must sync so the MCP has access.

## 3. Taxonomy and drift

- Event names must not drift.
- The taxonomy must be re-derived on every merge to main, so staleness is impossible by construction rather than by discipline. Events go stale extremely quickly as new features ship.
- Must diff the taxonomy per release and report what shipped untracked. That is a genuinely useful weekly artefact on its own.
- Must never require the customer to maintain a tracking plan by hand. That artefact is what rots, and asking them to keep it fresh makes their problem your feature.
- Must detect and alert when an event stops firing. Silent instrumentation death is the single most likely cause of a confidently wrong verdict. A refactor kills an event, every funnel built on it quietly breaks, and nobody notices for a month.

## 4. Data integrity and exclusions

- Internal accounts must be excluded so their events are never sent.
- Exclusions must cover bots, crawlers, uptime monitors, E2E test runs, load testing, staging and preview environments, and the customer's own coding agents browsing their app. Playwright traffic in CI will wreck an activation funnel.
- Exclusion must be automatic and retroactive, not a setup step. Time-scarce people will not maintain a list. Infer it from the org creator's email domain and backfill.
- Identity stitching across anonymous, signed-up and account must be handled, since activation is inherently a cross-session story. If stitching looks broken, Growthmind must flag it rather than quietly reporting nonsense.

## 5. Privacy and blast radius

- Must not put PII in the stream, and must be able to prove it. This gets much harder with English narratives, because free text captures things a typed field never would. Someone's name in a deck title ends up in your event description.
- Must not propose changes to pricing, billing, auth, consent flows or terms. Ever. A growth agent optimising a consent banner is a legal incident.
- Must not change behaviour for real users without a flag.
- Must be killable in one action, with everything it did reversible.
- Must never take an action the customer cannot inspect after the fact.

## 6. Findings: the quality bar

- Must attach confidence and sample size to every finding, and must refuse to make a call it cannot support. No verdict beats a wrong verdict.
- Must attach the evidence to every finding: session, count, timeframe. One click to the raw thing (the replay, the failed request, the funnel step). Unevidenced claims burn trust faster than silence.
- Must never assert causation it cannot prove. "Save failed" needs the absent network call, not an inference from repeated clicks.
- Must never send a finding without an estimated impact and a recommended action attached.
- Must distinguish a bug from a design problem from a user who simply changed their mind. Three different findings, three different owners.
- Must rank by expected value, not by frequency. Rage clicks on a settings page nobody monetises are not the top item.
- Every finding must carry a stable, deterministic ID so the same issue is always the same issue. English is the rendering, never the primitive.

## 7. Findings: volume, memory and backpressure

- Must apply backpressure. One thing at a time, not a ranked list of twelve. A ranked list hands the prioritising back to the customer, and it violates the time-scarce constraint.
- Must be hard rate-limited. A ceiling on findings per week, enforced, even when there are more.
- Must have a "nothing worth telling you today" state and actually use it. A daily digest that always finds something is a daily digest that is padding.
- Every finding must be dismissible. A dismissal is a signal, must be remembered, and must suppress that signature permanently.
- Must not surface a finding twice, and must not resurface one the customer has already seen and declined.

## 8. Experiments: design and dispatch

- Code changes must go through the developer's existing AI coding assistant.
- Every experiment must have its kill criterion and readout date set before it runs. No post hoc goalposts.
- Must refuse to run an experiment it can already calculate is underpowered, and must say so rather than running it anyway. This is blocker #1, and refusing is the feature.
- Must not run two experiments touching the same surface, or overlapping on the same funnel step, at once.
- Must cap concurrent open experiments. The bottleneck is their engineering time, not idea generation, so ranking has to be ruthless and the queue has to be short.
- Must remember everything already tried, including things killed and things the human overrode, and must not re-propose a dead idea. A stateless prompted agent cannot do this, which makes it the cleanest answer to blocker #5.

## 9. Experiments: verification and closure

- Must verify what actually shipped against what was specced, by inspecting the result rather than trusting the coding agent's completion message. Agents report success on partial work constantly.
- Must verify the change is live for real users before starting the clock. Flag key present, events firing, traffic split observed.
- Must chase. If the coding agent has not shipped in N days, it follows up, and after 2N it escalates or withdraws the experiment.
- Must close every experiment it opens. Every dispatched experiment terminates in persist, kill or inconclusive, with a date. Zero orphans, ever.
- The human must be able to kill any experiment at any moment, and the reason must be recorded and fed back into ranking.

## 10. Surface and interaction model

- Findings must be pushed, not pulled. Value must never depend on the customer remembering to check something.
- Must be fully legible in a single Slack message with no click-through. The link is for checking us, not for understanding us.
- Must never require the customer to babysit a running process or keep anything open.
- The web app is a first-class product surface, not an afterthought. It carries the account and its app shell — profile, sign-out, organisation switching, navigation — alongside connections, settings, billing, the audit log, and the findings record. Push delivery is what makes checking the app unnecessary; it is not a reason to build the app badly.
- The same artefact must be readable by a non-technical founder and parseable by a coding agent. One output, two audiences, no translation layer.
- Must not require the customer to learn new vocabulary. Scouts, signals, reports: that is a product taxonomy nobody asked to learn.

## 11. Architecture and ecosystem position

- Must not become the event source of truth or run a proprietary pipeline. This will be tempting to break the first time a customer's data is bad.
- Must work alongside their analytics, never require replacing it. Open question: an adapter pattern so a first-party source can be added later.
- Findings and experiment history must be exportable. Never be a system of record they cannot leave.

## 12. Cost

- Token cost falls on their budget, so consumption must be visible and predictable to them before a run, not after.
- Cost per customer must be bounded, not linear in their session volume. Otherwise your best customer is your worst margin.
- Must never run a model over every event. Deterministic pre-filter, model only on candidates that survive it.
