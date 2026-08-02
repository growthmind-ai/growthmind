import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RunFile } from "./types";

export interface RunPersister {
  readonly path: string;

  readonly save: (runFile: RunFile) => Promise<void>;
}

function errorCode(err: unknown): string | undefined {
  if (err instanceof Error && "code" in err) {
    const code: unknown = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

export function createRunPersister(runStartedAtIso: string): RunPersister {
  const fileSafeIso = runStartedAtIso.replaceAll(":", "-");
  const path = join("local", "spikes", `run-${fileSafeIso}.json`);

  async function save(runFile: RunFile): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = `${path}.tmp`;
    await writeFile(tmpPath, JSON.stringify(runFile, null, 2), "utf8");
    try {
      await rename(tmpPath, path);
    } catch (err: unknown) {
      const code = errorCode(err);
      if (code === "EEXIST" || code === "EPERM") {
        await unlink(path);
        await rename(tmpPath, path);
      } else {
        throw err;
      }
    }
  }

  return { path, save };
}
