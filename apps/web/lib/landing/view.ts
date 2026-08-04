import type { ScopedDb } from "@growthmind/db";
import {
  createEventsCounterService,
  createSlackConnectionsRepo,
  describeDriverError,
  findFirstProjectForOrg,
  isDeliveryTarget,
} from "@growthmind/db";
import type { ConnectionStateStatus, TenantContext } from "@growthmind/shared";
import {
  channelLabel,
  describeLandingLiveness,
  landingAttention,
  LANDING_DELIVERY_TEMPLATE,
  logger,
  type LandingAttention,
} from "@growthmind/shared";

export interface LandingView {
  // Non-null replaces the running lines entirely: a page that reports a fault and a
  // healthy summary at the same time has told the founder nothing.
  readonly attention: LandingAttention | null;

  readonly liveness: string | null;
  readonly deliveryLine: string | null;
}

const UNREADABLE: LandingView = { attention: null, liveness: null, deliveryLine: null };

interface SourceRead {
  readonly status: ConnectionStateStatus | null;
  readonly liveness: string | null;
}

const SOURCE_UNREADABLE: SourceRead = { status: null, liveness: null };

async function readSource(
  db: ScopedDb,
  ctx: TenantContext,
  projectId: string,
  nowMs: number,
): Promise<SourceRead> {
  try {
    const counter = await createEventsCounterService(db, ctx).read(projectId);

    return {
      status: counter.state.status,
      liveness: describeLandingLiveness({ counter, nowMs }),
    };
  } catch (error) {
    logger.error("landing: the analytics connection could not be read", {
      organizationId: ctx.organizationId,
      reason: describeDriverError(error),
    });
    return SOURCE_UNREADABLE;
  }
}

interface DeliveryRead {
  readonly hasTarget: boolean | null;
  readonly line: string | null;
}

async function readDelivery(db: ScopedDb, ctx: TenantContext): Promise<DeliveryRead> {
  try {
    const slack = await createSlackConnectionsRepo(db, ctx).getActiveForOrg();

    if (slack === null || !isDeliveryTarget(slack)) {
      return { hasTarget: false, line: null };
    }

    const label = channelLabel(slack) ?? slack.channelId;

    return {
      hasTarget: true,
      line: LANDING_DELIVERY_TEMPLATE.replaceAll("{channel}", label),
    };
  } catch (error) {
    logger.error("landing: whether what we find has anywhere to arrive could not be read", {
      organizationId: ctx.organizationId,
      reason: describeDriverError(error),
    });
    return { hasTarget: null, line: null };
  }
}

export interface LandingViewDeps {
  readonly db: ScopedDb;
  readonly ctx: TenantContext;
  readonly nowMs: number;
}

// Both sides are read here and the fault is derived here, so no caller threads a signal
// this page then has to remember to consume (D11). Either side failing degrades to silence
// on that half rather than taking the page down: `/` is the only way to reach the controls
// that repair whatever failed.
export async function readLandingView(deps: LandingViewDeps): Promise<LandingView> {
  const { db, ctx } = deps;

  let projectId: string;
  try {
    const project = await findFirstProjectForOrg(db, ctx);
    if (project === undefined) {
      return UNREADABLE;
    }
    projectId = project.id;
  } catch (error) {
    logger.error("landing: the project could not be read", {
      organizationId: ctx.organizationId,
      reason: describeDriverError(error),
    });
    return UNREADABLE;
  }

  const [source, delivery] = await Promise.all([
    readSource(db, ctx, projectId, deps.nowMs),
    readDelivery(db, ctx),
  ]);

  return {
    attention: landingAttention({
      sourceStatus: source.status,
      hasDeliveryTarget: delivery.hasTarget,
    }),
    liveness: source.liveness,
    deliveryLine: delivery.line,
  };
}
