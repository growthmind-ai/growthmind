export type BoundedBody =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly reason: "too_large" };

export async function readBoundedBody(request: Request, maxBytes: number): Promise<BoundedBody> {
  const stream = request.body;
  if (stream === null) {
    return { ok: true, bytes: new Uint8Array(new ArrayBuffer(0)) };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value === undefined) {
        continue;
      }

      total += value.byteLength;
      if (total > maxBytes) {
        // eslint-disable-next-line no-await-in-loop
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return { ok: true, bytes };
}
