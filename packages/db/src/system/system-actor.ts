import { tenantContextSchema, type TenantContext } from "@growthmind/shared";

export const SYSTEM_ACTOR = {
  SESSION_SOURCE_POLL: "system:session-source-poll",
  ANALYSIS_TICK: "system:analysis-tick",
  DELIVERY_TICK: "system:delivery-tick",
  GROWTH_CONTEXT_TICK: "system:growth-context-tick",
} as const;

export type SystemActor = (typeof SYSTEM_ACTOR)[keyof typeof SYSTEM_ACTOR];

export const SYSTEM_ACTOR_ROLE = "system";

export interface SystemScopeSource {
  readonly organizationId: string;
  readonly organizationName: string;
}

export function systemContextFor(actor: SystemActor, scope: SystemScopeSource): TenantContext {
  return tenantContextSchema.parse({
    userId: actor,
    organizationId: scope.organizationId,
    organizationName: scope.organizationName,
    role: SYSTEM_ACTOR_ROLE,
  });
}
