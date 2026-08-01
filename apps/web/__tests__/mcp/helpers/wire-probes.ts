// THE TWO INSTRUMENTS THE WIRE ROWS SHARE, AND NOTHING ELSE (O-013, Wave 0-T2).
//
// `./mcp-fixture.ts` mints requests and reads responses. This file holds the
// two probes that watch the PROCESS rather than the response — the things a
// `Request` in and a `Response` out cannot tell you:
//
//   - whether a promise rejected with nobody listening (`WIRE-W1`, `WIRE-B2`);
//   - whether a body that should carry nothing but a sentence has leaked a
//     stack frame or a file path into it (`WIRE-G6(a)`, `WIRE-B1`).
//
// WHY THEY LIVE HERE RATHER THAN IN THE TWO FILES THAT USE THEM. Each probe is
// used by exactly two rows in two different suites, and a hand-rolled copy in
// each is two chances to write a subtly weaker matcher — a leak scanner that
// misses `at ` because it only looked for `.ts:1:1`, or a rejection watcher
// that reads its list before the runtime has reported anything. One
// implementation is one place to get the flush right.
//
// THEY ARE NOT COMPARISON HELPERS. Neither returns a verdict on a response;
// they return raw material (a captured list, a boolean about a string) that a
// row asserts on, so nothing here can quietly narrow what a suite is willing to
// see. Every row using a scanner below also asserts it against a known-positive
// control, because a scanner that has gone blind passes forever.

/** What a watched run produced, and everything the runtime complained about
 * while it ran. */
export interface WatchedRun<T> {
  readonly result: T;
  /** The reasons of every rejection that reached the process with no handler.
   * Empty is the passing state; the values are carried so a failure message can
   * name what escaped rather than only that something did. */
  readonly unhandled: readonly unknown[];
}

/**
 * Runs `run`, capturing any unhandled promise rejection the process reports
 * while it does.
 *
 * ⚠️ THE FLUSH IS THE WHOLE POINT. A rejection with no handler is reported by
 * the runtime AFTER the microtask queue drains, so a watcher that reads its
 * list the instant `run()` resolves reads an empty list every time and the row
 * using it passes forever. One macrotask turn is awaited before the list is
 * handed back.
 *
 * The listener is removed in a `finally`, so a row that throws mid-assertion
 * cannot leave a capture hook installed for the rest of the file.
 */
export async function watchForUnhandledRejections<T>(
  run: () => Promise<T>,
): Promise<WatchedRun<T>> {
  const unhandled: unknown[] = [];
  const capture = (reason: unknown): void => {
    unhandled.push(reason);
  };

  process.on("unhandledRejection", capture);
  try {
    const result = await run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { result, unhandled };
  } finally {
    process.off("unhandledRejection", capture);
  }
}

/**
 * Does `text` contain something shaped like a stack frame?
 *
 * Two shapes, because a leak arrives as either: V8's `    at someFunction (…)`
 * frame line, and the `file.ts:12:5` position that rides on almost every
 * runtime error message even when the frames themselves were stripped.
 *
 * BOTH PATTERNS ARE ANCHORED ON PURPOSE, AND THE ANCHORS ARE THE DIFFERENCE
 * BETWEEN A GUARD AND A NUISANCE. A frame line is matched only where `at`
 * begins a line, because "at" is an ordinary English word and every refusal
 * this surface produces is an English sentence. A position is matched only
 * where it follows a file extension, because `00:00:00` inside an ISO timestamp
 * is not a stack frame and a fixture window carries two of them.
 */
export function carriesStackFrame(text: string): boolean {
  return /(^|\n)\s*at\s+\S/.test(text) || /\.\w{1,4}:\d+:\d+/.test(text);
}

/**
 * Does `text` contain something shaped like a path into this repository?
 *
 * A refusal that names a source file tells a caller how this server is built
 * and, worse, is the first half of a stack trace arriving one edit later. The
 * extensions are listed rather than matched loosely so an ordinary sentence
 * containing a full stop and a word cannot register as a file name.
 */
export function carriesFilePath(text: string): boolean {
  return /[\w./-]+\.(?:ts|tsx|mts|cts|mjs|cjs|js)\b/.test(text);
}
