export function heartbeatMessage(now: Date): string {
  return `worker alive at ${now.toISOString()}`;
}
