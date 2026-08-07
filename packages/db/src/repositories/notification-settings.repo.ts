import type { DigestCadence, TenantContext, Weekday } from "@growthmind/shared";

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

// The primary key is the organization, so there is no parameter through which one org
// could ever name another's row.
export function createNotificationSettingsRepo(
  _db: ScopedExecutor,
  _ctx: TenantContext,
): NotificationSettingsRepo {
  return {
    read(): Promise<NotificationSettingsRow> {
      throw new Error("O-051 job 2: not implemented");
    },

    save(_input: SaveNotificationSettingsInput): Promise<NotificationSettingsRow> {
      throw new Error("O-051 job 2: not implemented");
    },
  };
}
