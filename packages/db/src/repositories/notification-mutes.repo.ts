import {
  memberUserId,
  type MutableNotificationClass,
  type TenantContext,
} from "@growthmind/shared";
import { and, eq } from "drizzle-orm";

import { notificationMutes } from "../schema/notification-mutes";
import { scoped } from "./scope";
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
  db: ScopedExecutor,
  ctx: TenantContext,
): NotificationMutesRepo {
  const s = scoped(db, ctx);

  function requirePerson(operation: string): string {
    const userId = memberUserId(ctx);

    if (userId === null) {
      throw new Error(
        `notification_mutes.${operation}: a mute belongs to a person, and this principal is a machine`,
      );
    }

    return userId;
  }

  return {
    async listMutedClasses(): Promise<readonly MutableNotificationClass[]> {
      const rows = await db
        .select({ mutedClass: notificationMutes.class })
        .from(notificationMutes)
        .where(s.owned(notificationMutes, eq(notificationMutes.userId, ctx.userId)))
        .orderBy(notificationMutes.class);

      return rows.map((row) => row.mutedClass);
    },

    async mute(mutedClass: MutableNotificationClass): Promise<void> {
      const userId = requirePerson("mute");

      // Presence means hidden, and the PK makes a second press free.
      await db
        .insert(notificationMutes)
        .values({ ...s.stamp, userId, class: mutedClass })
        .onConflictDoNothing({
          target: [
            notificationMutes.organizationId,
            notificationMutes.userId,
            notificationMutes.class,
          ],
        });
    },

    async unmute(mutedClass: MutableNotificationClass): Promise<void> {
      const userId = requirePerson("unmute");

      // Deleting what was never there is a no-op: the card's checkbox can be pressed in
      // any order.
      await db
        .delete(notificationMutes)
        .where(
          and(
            s.org(notificationMutes),
            eq(notificationMutes.userId, userId),
            eq(notificationMutes.class, mutedClass),
          ),
        );
    },
  };
}
