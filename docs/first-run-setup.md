# First-run setup: clone to a watching product

The shortest honest path from `git clone` to a Growthmind that is watching your
product, for someone who has never seen this repository. Two sections: getting
it running on your machine, and getting it connected to your product.

Everything here is what exists today. Where a step is still yours to do by hand,
it says so.

## 1. Run it

Copy-paste these in order. Nothing is hidden between them.

```bash
git clone https://github.com/growthmind-ai/growthmind.git
cd growthmind
bun install
docker compose up -d postgres
bun run db:migrate
bun run dev
```

Then, in a second terminal:

```bash
bun run dev:worker
```

That is the whole of it. The app is on [localhost:3000](http://localhost:3000).

Four notes on what those commands are:

- **bun, never npm, yarn or pnpm.** Another package manager writes a second
  lockfile that CI's `bun install --frozen-lockfile` rejects. bun 1.3 or newer.
- **`docker compose up -d postgres`** starts Postgres with pgvector and nothing
  else. Bring up the whole stack instead — `docker compose up`, no service name
  — and you get Postgres, the app and the worker in one command, with the
  migrations already applied inside the container. That is the demo path; the
  six commands above are the development path, where the app and worker run on
  your machine and reload as you edit.
- **`bun run db:migrate`** creates the tables. A fresh database has none, so
  sign-up fails without it. Run it again whenever you pull migrations.
- **`bun run dev:worker`** is the background process that polls your analytics
  and does the analysis. Without it the app runs, setup completes, and nothing
  is ever found.

**No environment variables are required.** There is no `.env` to write and no
secret to generate. Every variable the app needs has a working local default
(`packages/shared/src/env.ts`), which is why the commands above have no
configuration step in them. `.env.example` is the full list for when you deploy,
or when you want the one-click Slack path described below.

Once it is up: create an account at
[localhost:3000/sign-up](http://localhost:3000/sign-up) — your name, an email, a
password — and your workspace is made for you. Press **Set up Growthmind** on
the page you land on. That is the first-run screen, and section 2 is what it
asks for.

## 2. Activate it

**Seven actions.** That is the whole of setup on the first-run screen, on the
one-click path: one paste, five presses, and one choice from a list. Six of them
are on Growthmind's own screen and one is on Slack's.

Before you start, one credential is worth fetching, and it is the only one:

| What                                       | Where it comes from                                                                                                                                                                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A PostHog personal API key** (`phx_...`) | In PostHog: Settings → Personal API keys. Create one with read access to projects. It is your personal key, not the project key.                                                                                                                    |
| **Slack**                                  | Nothing to fetch if this installation has a Slack app configured — you press a button. If it does not, you bring a bot token (`xoxb-...`) and a channel ID from a Slack app of your own. See `.env.example` for making one, or skip Slack entirely. |

Then, in order:

1. **Paste the personal API key** into the one visible field on the analytics
   step.
2. **Press Connect.** Growthmind asks PostHog which projects that key can read.
   One project, and it is connected on the spot and the screen names which one.
   Several, and you get the list — picking is the connecting.
3. **Press Add to Slack.**
4. **Approve on Slack's screen**, choosing the workspace.
5. **Choose the channel** from the list you land back on.
6. **Press Send a test message.** The message lands in the channel and names the
   workspace and who connected it, so your teammates find out from the channel
   rather than from you.
7. **Press Start watching.**

After that, the screen is watching and the eighth thing is not a click at all —
see "The part that is yours" below. When the finding arrives, **Done** retires
the first-run screen for good.

### If this installation has no Slack app

The Slack step is then the pasted-token form instead of the button, and it is
the primary path rather than a fallback — a self-hosted Growthmind with no Slack
app of its own is a first-class install, not a broken one. Paste a bot token and
a channel ID, then press Send a test message. Steps 3 to 6 become two fields and
one press.

**Skip for now** is on the Slack step at every moment, including after a
failure. Setup still reaches Start watching without Slack, and the screen still
shows you the finding. Nothing arrives anywhere else until Slack is connected,
and the screen says so rather than letting you find out later.

### What you no longer have to go and find

Every one of these used to be a question on this screen, and each was work the
product could do instead of asking. Their absence is the point:

- **No project number.** The key alone tells us which projects it can reach. If
  there is exactly one, it is chosen for you and the screen names it, with the
  way back out in the same sentence.
- **No region choice.** Both hosted PostHog regions are tried for you. The
  question about an address of your own appears only if both come back refused —
  so if you are on either hosted region, you never meet it at all.
- **No channel ID.** On the Add to Slack path the channel comes from a live list
  of the ones the bot can reach, fetched when you open it, so a channel you made
  a minute ago is in it. Nothing is cached and there is nothing to refresh.
- **No bot token**, when a Slack app is configured. Nothing is typed and nothing
  is copied out of Slack's settings.

### The part that is yours

Growthmind will not manufacture a finding to show you. Once you have pressed
Start watching, **go and break something in your own product** — a save that
returns an error, a button that does nothing — and then come back to the tab.

That is deliberate and it is not going to be automated away. The payoff of this
screen is a real finding, built from a real failed request in your own product,
with the evidence attached. A simulated one would prove nothing about whether
this works on your funnel, which is the only question the screen exists to
answer. The screen rebuilds itself from what already happened, so you can leave
the tab and come back.

If nothing is found, that is a real answer about a quiet product rather than a
setup problem — break something more obvious and watch again.

## Where to go next

- [`docs/get-started.md`](get-started.md) — the experience this setup is held
  to, beat by beat, and how to point your coding agent at Growthmind over MCP.
- [`AGENTS.md`](../AGENTS.md) — the contributor guide: stack, commands,
  conventions, and the commitments a PR is judged against.
