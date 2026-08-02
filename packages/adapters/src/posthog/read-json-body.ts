import { MAX_RESPONSE_BYTES, MAX_RESPONSE_CHUNKS } from "./constants";

// Bounded read from a host we do not control, never throwing across the boundary:
// declared length, then total bytes, then chunk count. Anything unreadable is `null`.
export async function readJsonBody(response: Response): Promise<unknown> {
  try {
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;

    const body = response.body;
    if (!body) return (await response.json()) as unknown;

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    // Capped by chunk count as well as bytes: endless zero-length chunks would satisfy
    // the byte cap forever. This package forbids unbounded loops and asserts it.
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
