# Spike — where is `GET /api/projects/` served, and what does it return?

**Run:** 2026-08-01, against a live PostHog cloud account with a real personal API key
(`phx_…`, 52 chars). Read-only; no writes were made.

**Question it settles:** the first-run screen wants to discover a founder's projects from
their key alone, so the project-number field can be deleted. `eventsUrl` builds
`${host}/api/projects/{id}/events` on a host that ships prefilled as
`https://us.i.posthog.com` — an **ingest** origin. Nothing established whether the
project **list** endpoint (no id segment) is served there or only on the app origin.

## Result

| Origin | Status | Body |
|---|---|---|
| `https://us.i.posthog.com` | **401** | `{type, code, detail, attr}` |
| `https://us.posthog.com` | **401** | `{type, code, detail, attr}` |
| `https://eu.i.posthog.com` | **200** | `results[]`, len 1 |
| `https://eu.posthog.com` | **200** | `results[]`, len 1 |

## Findings

1. **`/api/projects/` IS served on the ingest origin.** `eu.i.posthog.com` answered 200
   with the same body as `eu.posthog.com`. The probe list can therefore use the same
   origin family the connect path already stores, and a discovered host needs no
   translation before it is written to `project_connections`.

2. **A key from the wrong region returns `401`, not `403`, and never `200` with an empty
   list.** This is the fallthrough trigger for the probe: US answered 401 for an
   EU-issued key, and EU then answered 200. The ordered US→EU walk works exactly as
   designed, and the "empty results" case the ADD worried about did not occur here.

3. **The list response carries no event-count field.** Keys observed on each result:

   ```
   id, uuid, organization, project_id, api_token, name,
   completed_snippet_onboarding, has_completed_onboarding_for,
   ingested_event, is_demo, timezone, access_control
   ```

   There is **`ingested_event` (boolean)** but no recent-volume number.

4. **`id` is the segment `eventsUrl` needs.** Note that `project_id` is also present and
   is a *different* value — using it would build a URL for the wrong project. The
   discovery mapper must take `id`.

## Consequences for the ADD

| ADD claim | Was | Now |
|---|---|---|
| `/api/projects/` on the ingest origin | UNVALIDATED | **verified** — use the `*.i.posthog.com` family |
| Wrong/scope-less key returns 403 | assumed | **401 observed.** Treat 401 and 403 alike as "try the next origin", and only refuse after both |
| Order picks by recent event volume | assumed available | **not available.** Order by `ingested_event` true-first, then name. A boolean, not a count |
| `sourceProjectId` source field | unstated | **`id`**, never `project_id` |

Finding 4 is the one that would have shipped a silent bug: both fields are present, both
are plausible names, and the wrong one produces a valid-looking URL for someone else's
project number.
