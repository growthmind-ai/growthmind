import { driverMessageSchema, type ActCommand, type DriverMessage } from "./protocol";

export interface DriverOptions {
  readonly url: string;
  readonly outDir: string;
  readonly width: number;
  readonly height: number;
  readonly driverPath: string;
}

export class DriverProtocolError extends Error {}

async function* readMessages(stream: AsyncIterable<Uint8Array>): AsyncGenerator<DriverMessage> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      yield driverMessageSchema.parse(JSON.parse(line));
    }
  }
}

/**
 * Owns the Node subprocess that holds the browser. Node, not bun: bun cannot launch Playwright
 * on Windows, so a line protocol over stdio is the only bun-side contract.
 */
export class BrowserDriver {
  private readonly process: ReturnType<typeof Bun.spawn>;
  private readonly messages: AsyncGenerator<DriverMessage>;

  constructor(options: DriverOptions) {
    this.process = Bun.spawn({
      cmd: [
        "node",
        options.driverPath,
        "--url",
        options.url,
        "--out-dir",
        options.outDir,
        "--width",
        String(options.width),
        "--height",
        String(options.height),
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });

    const stdout = this.process.stdout;
    if (!(stdout instanceof ReadableStream)) {
      throw new DriverProtocolError("driver stdout is not a stream");
    }
    this.messages = readMessages(stdout as unknown as AsyncIterable<Uint8Array>);
  }

  async next(): Promise<DriverMessage> {
    const step = await this.messages.next();
    if (step.done === true) {
      throw new DriverProtocolError("driver closed before sending a message");
    }
    return step.value;
  }

  send(command: ActCommand | { readonly type: "finish" }): void {
    const stdin = this.process.stdin;
    if (stdin === undefined || stdin === null || typeof stdin === "number") {
      throw new DriverProtocolError("driver stdin is not writable");
    }
    void stdin.write(`${JSON.stringify(command)}\n`);
    void stdin.flush();
  }

  async close(): Promise<void> {
    await this.process.exited;
  }
}
