import type { MutableNotificationClass, TenantContext } from "@growthmind/shared";

import type { ScopedExecutor } from "./types";

export interface NotificationMutesRepo {
  // What this viewer has turned off, and nobody else's: a mute changes one person's bell
  // and nothing that is recorded.
  listMutedClasses(): Promise<readonly MutableNotificationClass[]>;

  mute(mutedClass: MutableNotificationClass): Promise<void>;

  unmute(mutedClass: MutableNotificationClass): Promise<void>;
}

// Which person comes from the context, never from a caller — the same reason the bell's
// own watermarks refuse a machine principal.
export function createNotificationMutesRepo(
  _db: ScopedExecutor,
  _ctx: TenantContext,
): NotificationMutesRepo {
  return {
    listMutedClasses(): Promise<readonly MutableNotificationClass[]> {
      throw new Error("O-051 job 2: not implemented");
    },

    mute(_mutedClass: MutableNotificationClass): Promise<void> {
      throw new Error("O-051 job 2: not implemented");
    },

    unmute(_mutedClass: MutableNotificationClass): Promise<void> {
      throw new Error("O-051 job 2: not implemented");
    },
  };
}
