# Telemetry

**A self-hosted Growthmind sends nothing to us. No usage counters, no version
pings, no error reporting, no licence checks, no anonymous statistics, and no
opt-in switch that a future release quietly flips.**

That is a commitment, not a default. It is written here because a product that
records how people use your software has no business being vague about what it
records about you, and because "we take privacy seriously" is not a fact anyone
can check.

## What the self-hosted stack talks to

Every network destination is one you configured, using your credential, and
Growthmind has no path to any of them:

| Destination                               | Why                                           | Optional? |
| ----------------------------------------- | --------------------------------------------- | --------- |
| Your Postgres (`DATABASE_URL`)            | The database. Everything lives here           | Required  |
| Your model provider (`ANTHROPIC_API_KEY`) | Session analysis. Your key, your budget (§12) | Optional  |
| Your Slack workspace                      | Where findings are delivered (§10)            | Optional  |
| Your analytics, if you connect one        | Reading events you already collect (§11)      | Optional  |
| Your repo host, read-only                 | Context for fix specs. Source is never stored | Optional  |

Leave the optional ones unset and the stack still boots and runs — that is what
"graceful absence" means in [`AGENTS.md`](../AGENTS.md). None of these routes
through us, and none of them is a Growthmind endpoint.

## Verify it yourself

Do not take the table above on trust. It is checkable in about a minute.

**Read every outbound call in the source.** There are few enough to audit by
hand:

```bash
grep -rnE "fetch\(|https?://|sendBeacon|new WebSocket|axios" \
  --include="*.ts" --include="*.tsx" apps packages worker
```

Today that returns three links on the landing page that a human clicks, and one
`http://localhost:3000` default. Nothing else. There is no analytics client, no
error-reporting SDK, and no version check in the tree to find.

**Read the entire list of environment variables.** It is a single Zod schema —
[`packages/shared/src/env.ts`](../packages/shared/src/env.ts) — and
[`.env.example`](../.env.example) documents each one. No variable points at a
Growthmind service, so there is no endpoint for data to reach even by accident.

**Cut off the internet.** Once the images are built, run the stack with outbound
traffic blocked. Nothing in the core loop needs the public internet except the
optional destinations above, so if something breaks that you did not configure,
that is a bug — [report it](../SECURITY.md).

## The browser SDK

`@growthmind/sdk-js` runs in _your_ users' browsers, so it deserves saying
separately: it sends captured events to **your** ingest endpoint — your
self-hosted instance — and nowhere else. Recordings are masked DOM
reconstructions, masked at capture, before anything leaves the browser
(product decisions §5). There is no second destination, and no configuration
that adds one.

## The hosted service is a different thing

If you use the cloud at growthmind.ai, your data reaches our servers — that is
the entire point of paying someone else to run it, and it is not telemetry.
What we do with it is governed by the product decisions, in particular §5 on
PII and §7 on retention and export. This document is about the software in this
repository, running on your infrastructure.

## If this ever changes

It would need a change to this file, in a pull request, in public, before any
code shipped — and it would be opt-in and off by default, because a privacy
promise you can revoke silently was never a promise. If you find behaviour in
this repository that contradicts anything above, that is a security issue and
[SECURITY.md](../SECURITY.md) is the fastest way to reach us.
