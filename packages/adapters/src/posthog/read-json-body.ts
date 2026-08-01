// Reading a JSON body from a host we do not control, without ever throwing across the
// boundary.
//
// Its own module because it has two consumers: the poll client (`client.ts`) and the
// project-list probe (`discovery.ts`). Both fetch from a customer-supplied host, and
// both need the same three bounds — declared length, total bytes, chunk count. One
// implementation imported twice, never a copy: a copied reader drifts, and the copy that
// drifts is the one nobody is looking at the day a hostile host starts streaming.
import { MAX_RESPONSE_BYTES, MAX_RESPONSE_CHUNKS } from "./constants";

/**
 * Reads a JSON body without ever throwing across this boundary. A proxy's HTML error
 * page, an empty 204-shaped body, or a truncated response all degrade to `null`, which
 * `mapFailure` then classifies from the status alone.
 */
export async function readJsonBody(response: Response): Promise<unknown> {
  try {
    // The caller's request count is bounded (`MAX_PAGES_PER_RUN` for the walk, one per
    // origin for the probe); the bytes are not. An unbounded body means a hostile host
    // can oom the worker once per permitted request. Reject on the declared length
    // first (cheap), then guard the undeclared case by reading with a byte counter that
    // aborts past the cap.
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;

    const body = response.body;
    if (!body) return (await response.json()) as unknown;

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    // Bounded by chunk count as well as by bytes. `for` would be the natural shape
    // here and is deliberately not used: this package forbids unbounded loops outright
    // and asserts it with a structural test, because every loop in it is driven by a
    // hostile-capable remote. A stream that yields endless zero-length chunks would
    // satisfy the byte cap forever, so the iteration count is capped too.
    let readsRemaining = MAX_RESPONSE_CHUNKS;
    while (readsRemaining > 0) {
      readsRemaining -= 1;
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    if (readsRemaining === 0) {
      // Hit the chunk ceiling without `done`. Treat as unreadable, never as a
      // truncated-but-valid body.
      await reader.cancel();
      return null;
    }

    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(joined)) as unknown;
  } catch {
    return null;
  }
}
