export interface WatchedRun<T> {
  readonly result: T;

  readonly unhandled: readonly unknown[];
}

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

export function carriesStackFrame(text: string): boolean {
  return /(^|\n)\s*at\s+\S/.test(text) || /\.\w{1,4}:\d+:\d+/.test(text);
}

export function carriesFilePath(text: string): boolean {
  return /[\w./-]+\.(?:ts|tsx|mts|cts|mjs|cjs|js)\b/.test(text);
}
