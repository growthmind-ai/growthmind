// Impure shell: incremental atomic persistence of the run file (file 11). One file per
// run under gitignored local/spikes/; rewritten atomically after every trial so a crash
// preserves completed trials. Writes only RunFile-typed data. Credentials cannot reach
// disk by construction (RunMetadata carries a host region string only). No filesystem
// effect happens at module load; only save touches disk.

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { RunFile } from "./types";

/** Handle for one run's persistence: a fixed target path and an atomic save. */
export interface RunPersister {
  /** The run file's path, fixed once per run. */
  readonly path: string;
  /** Atomically rewrite the run file (write tmp → rename over target). */
  readonly save: (runFile: RunFile) => Promise<void>;
}

/** Extract a Node fs error code without widening to `any`. */
function errorCode(err: unknown): string | undefined {
  if (err instanceof Error && "code" in err) {
    const code: unknown = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * Fix the run file's target path from the run's start timestamp (colons are not
 * filename-safe on Windows → dashes) and return an atomic saver.
 *
 * save ensures `local/spikes/` exists, serialises the RunFile with 2-space indentation,
 * writes to `<path>.tmp`, then renames over `<path>`. On Windows a rename over an
 * existing file can throw eexist/eperm. In that case the target is unlinked and the
 * rename retried. Genuine fs failures propagate to the caller (the entrypoint decides
 * how to surface them).
 */
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
