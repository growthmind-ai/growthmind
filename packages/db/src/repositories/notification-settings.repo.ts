import {
  DIGEST_CADENCE_DEFAULT,
  DIGEST_DAY_DEFAULT,
  type DigestCadence,
  type TenantContext,
  type Weekday,
} from "@growthmind/shared";

import { orgCrud } from "./crud";
import { notificationSettings } from "../schema/notification-settings";
import type { ScopedExecutor } from "./types";

export interface NotificationSettingsRow {
  readonly digestCadence: DigestCadence;
  readonly digestDay: Weekday;
}

export interface SaveNotificationSettingsInput {
  readonly cadence: DigestCadence;

  readonly day: Weekday;
}

export interface NotificationSettingsRepo {
  // Never null: no row means the documented defaults, applied here so there is one place
  // that knows them and no seed row, bootstrap or backfill has to exist.
  read(): Promise<NotificationSettingsRow>;

  save(input: SaveNotificationSettingsInput): Promise<NotificationSettingsRow>;
}

function toRow(row: {
  readonly digestCadence: DigestCadence;
  readonly digestDay: Weekday;
}): NotificationSettingsRow {
  return { digestCadence: row.digestCadence, digestDay: row.digestDay };
}

// The primary key is the organization, so there is no parameter through which one org
// could ever name another's row.
export function createNotificationSettingsRepo(
  db: ScopedExecutor,
  ctx: TenantContext,
): NotificationSettingsRepo {
  const c = orgCrud(db, ctx, notificationSettings);

  return {
    async read(): Promise<NotificationSettingsRow> {
      const row = await c.maybe();

      return row === null
        ? { digestCadence: DIGEST_CADENCE_DEFAULT, digestDay: DIGEST_DAY_DEFAULT }
        : toRow(row);
    },

    async save(input: SaveNotificationSettingsInput): Promise<NotificationSettingsRow> {
      const saved = await c.insertOrFetch(
        {
          digestCadence: input.cadence,
          digestDay: input.day,
        },
        {
          target: [notificationSettings.organizationId],
          set: {
            digestCadence: input.cadence,
            digestDay: input.day,
            updatedAt: new Date(),
          },
          fetch: [],
        },
      );

      return toRow(saved);
    },
  };
}
