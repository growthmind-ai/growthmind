import { ROUTES } from "./routes";

export function findingPath(id: string): string {
  return `${ROUTES.findings}/${encodeURIComponent(id)}`;
}

export function fixPath(findingId: string): string {
  return `${ROUTES.fixes}/${encodeURIComponent(findingId)}`;
}

export function experimentPath(findingId: string): string {
  return `${ROUTES.experiments}/${encodeURIComponent(findingId)}`;
}
