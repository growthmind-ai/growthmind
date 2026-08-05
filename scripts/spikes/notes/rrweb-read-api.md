# Spike — rrweb.com read API shape probe

**Run:** 2026-08-05, against `https://api.rrweb.com` with a live read-scoped key. Read-only; no writes were made.

**Question it settles:** the recordings envelope, id key, cursor shape, and events envelope in `packages/adapters/src/rrweb/parse.ts` were written tolerant because a live probe on 2026-08-04 (before a read-scoped key existed) returned 401 `missing scope read:recordingMetadata` on every read endpoint. This file is that probe's real output.

## Result

- **ROW 1 Base path — PINNED.** `/recordings` answers 200 with this key (untried: /rr/recordings)

- **ROW 2 Recordings envelope — PINNED.** envelope is { recordings: [...] } (2 item(s)); id key is `recordingId`; timestamp-ish keys: ["timestamp"]

- **ROW 3 Cursor — FAILED-TO-PIN.** no key among next|nextCursor|next_cursor carried a non-empty string on the recordings response

- **ROW 4 Events envelope — PINNED.** envelope is bare array (438 item(s)); items ARE bare rrweb {type,timestamp,data} objects

- **ROW 5 Error shapes — PINNED.** wrong-key request -> 401 (body logged above); bogus-recording-id request -> 400. 403 and 429 are not deliberately triggered — this probe never bursts — so they are pinned only if one appeared incidentally above

A row can only pin what the account holds. Rows 2 to 4 read a recording's own shape,
so they stay unpinned until capture has sent at least one recording; re-run the probe
once it has.
