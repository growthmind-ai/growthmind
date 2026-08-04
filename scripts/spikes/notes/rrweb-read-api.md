# Spike — rrweb.com read API shape probe (NOT YET RUN)

**Status: placeholder.** No read-scoped key has existed yet to run
`scripts/spikes/rrweb-shape-probe.ts` for real. Nothing below is observed — it
is the set of questions the probe will answer once Tom mints a key with the
`read:recordingMetadata` scope at app.rrweb.com/api-keys and sets
`RRWEB_READ_API_KEY`. Absent notes here are not a verified API; they are an
unrun probe. Running the script overwrites this file with real findings —
until it has, do not treat `packages/adapters/src/rrweb/parse.ts` or
`constants.ts` as pinned against the live API.

## What the live probe on 2026-08-04 established

A live probe using the capture-side public key returned 401
`missing scope read:recordingMetadata` on every read endpoint tried. That
attempt pinned nothing about the read API's shape — it only confirmed that
reading recordings needs a separate, read-scoped key, distinct from the
capture-side `NEXT_PUBLIC_RRWEB_PUBLIC_KEY`.

## Questions this probe will settle, once it runs

| Row | Question | Current adapter assumption |
| --- | --- | --- |
| ROW 1 | Base path: `/recordings` or `/rr/recordings`? | `/recordings` (`RECORDINGS_PATH` in `packages/adapters/src/rrweb/constants.ts`) |
| ROW 2 | Recordings list envelope, id key, timestamp keys | tolerant of `recordings\|results\|data\|items` and `id\|recordingId\|recording_id` (`parse.ts`) |
| ROW 3 | Pagination cursor key, absolute URL vs opaque token | tolerant of `next\|nextCursor\|next_cursor`, but treated as a same-origin absolute URL (`cursorOf` in `parse.ts`) — an opaque token would currently be dropped as malformed, ending pagination after one page |
| ROW 4 | Events endpoint envelope, bare `{type,timestamp,data}` items | tolerant of `events\|results\|data`; items parsed against `rrwebEventSchema` |
| ROW 5 | 401/403/404/429 body shapes | mapped in `errors.ts` by status code alone, plus a `missing scope` string match on 401 |

## How to run it

```bash
RRWEB_READ_API_KEY=<read-scoped key> bun scripts/spikes/rrweb-shape-probe.ts
```

`RRWEB_HOST` defaults to `https://api.rrweb.com`; override it only if the
account's read API is served elsewhere. The script never prints the key, and
every request is bounded — no burst, no unbounded retry.
