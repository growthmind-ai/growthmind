/**
 * Handlers are plain exported functions with typed payloads. No queue types in their
 * signatures, so they are testable without a queue and portable if the queue ever
 * changes (docs/stack.md, Phase 3). Queue registration lives in index.ts, the only
 * queue-aware file.
 */
export function heartbeatMessage(now: Date): string {
  return `worker alive at ${now.toISOString()}`;
}
