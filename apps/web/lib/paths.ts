import { ROUTES } from "./routes";

export function findingPath(id: string): string {
  return `${ROUTES.findings}/${encodeURIComponent(id)}`;
}

export function experimentPath(findingId: string): string {
  return `${ROUTES.experiments}/${encodeURIComponent(findingId)}`;
}
