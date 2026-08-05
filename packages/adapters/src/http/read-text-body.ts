import { MAX_RESPONSE_BYTES, MAX_RESPONSE_CHUNKS } from "./constants";

// Sibling of readJsonBody with the same bounds (declared length, then total bytes, then
// chunk count) and the same never-throw contract, decoding text instead of parsing JSON:
// the snapshot endpoint answers JSONL, and JSON.parse on the whole body would fail there.
export async function readTextBody(response: Response): Promise<string | null> {
  try {
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;

    const body = response.body;
    if (!body) return await response.text();

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
    return new TextDecoder().decode(joined);
  } catch {
    return null;
  }
}
