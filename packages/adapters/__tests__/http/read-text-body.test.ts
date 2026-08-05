import { describe, expect, test } from "bun:test";

import { MAX_RESPONSE_BYTES, MAX_RESPONSE_CHUNKS } from "../../src/http/constants";
import { readTextBody } from "../../src/http/read-text-body";

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

describe("readTextBody", () => {
  test("decodes a normal jsonl body as-is, not as parsed json", async () => {
    const jsonl = '{"type":2,"timestamp":1}\n{"type":3,"timestamp":2}\n';
    const response = new Response(jsonl, {
      status: 200,
      headers: { "content-type": "application/jsonl" },
    });

    await expect(readTextBody(response)).resolves.toBe(jsonl);
  });

  test("refuses a declared content-length over the cap without reading the stream", async () => {
    const response = new Response("small body", {
      status: 200,
      headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) },
    });

    await expect(readTextBody(response)).resolves.toBeNull();
  });

  test("cuts off mid-stream once the total bytes read cross the cap, with no declared length", async () => {
    const half = new Uint8Array(Math.ceil(MAX_RESPONSE_BYTES * 0.6));
    const response = new Response(streamOf([half, half]), { status: 200 });

    await expect(readTextBody(response)).resolves.toBeNull();
  });

  test("a body with no stream decodes as empty text rather than throwing", async () => {
    const response = new Response(null, { status: 200 });

    expect(response.body).toBeNull();
    await expect(readTextBody(response)).resolves.toBe("");
  });

  test("gives up once chunk count exceeds the cap, even though no single chunk is large", async () => {
    const chunks = Array.from({ length: MAX_RESPONSE_CHUNKS + 1 }, () => new Uint8Array([0x61]));
    const response = new Response(streamOf(chunks), { status: 200 });

    await expect(readTextBody(response)).resolves.toBeNull();
  });
});
