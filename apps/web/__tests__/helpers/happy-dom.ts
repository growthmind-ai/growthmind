import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Preloaded from bunfig.toml. `.claude/rules/test-requirements.md` requires a component using
// hooks to be driven through a real renderer, and until O-050 this repo had none — every
// component test rendered to static markup, which cannot fire an event or move focus.
//
// happy-dom also replaces bun's fetch and stream stack, and its versions are not interchangeable:
// registering it unguarded broke 58 tests across the Slack OAuth routes and the MCP wire suites,
// which pass a signal into fetch and read an SSE-framed Response. What this preload is for is the
// document, the event loop and the style engine, so bun's own implementations are put back.
const NATIVE = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "Blob",
  "File",
  "AbortController",
  "AbortSignal",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "WebSocket",
] as const;

if (globalThis.document === undefined) {
  const native = new Map<string, unknown>();
  for (const name of NATIVE) native.set(name, Reflect.get(globalThis, name));

  GlobalRegistrator.register({ url: "http://localhost:3000/replays" });

  for (const [name, value] of native) {
    if (value !== undefined) Reflect.set(globalThis, name, value);
  }
}
