// Turning an unknown thrown value into something a person can read.
//
// `catch (error)` binds `unknown`, and every log line that wants to say WHAT
// went wrong has to narrow it first. This is that narrowing, in one place.
//
// It existed as a byte-identical private copy in all three worker tasks
// (`analysis-tick`, `delivery-tick`, `session-source-poll`) plus a fourth
// inlined ternary in `analysis-lane-source`. Four copies of four lines is not
// expensive in itself; the reason it is worth one home is that the NEXT
// background task writes a fifth, and a shared export is the thing that makes
// the fifth author import instead of retype.

/**
 * The message from a thrown value, whatever it turned out to be.
 *
 * A thrown non-`Error` (a string, a plain object, a rejected value from a
 * library that predates the convention) is stringified rather than dropped:
 * every catch site in this codebase logs to explain a failure to a human, and
 * "[object Object]" is a worse answer than nothing only if nothing were an
 * option — it is not, because the alternative is a log line that says a failure
 * happened and refuses to say what it was.
 *
 * Deliberately NOT a formatter: no prefix, no stack, no JSON. Callers compose
 * their own sentence around it, because the sentence is where the context lives
 * ("project X could not finish its check — ${describeError(e)}"), and a helper
 * that guessed at that framing would be wrong at most call sites.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
