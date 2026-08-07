import { redirect } from "next/navigation";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { findMembershipsByUserId, readBellSnapshot } from "@growthmind/db";

import { AppFrame } from "@/components/app/AppFrame";
import { LiveRefresh } from "@/components/live/LiveRefresh";
import { navGroupsFor } from "@/lib/app-nav";
import { getAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { toBellViewModel, type BellViewModel } from "@/lib/notifications/bell";
import { viewerMaySeePreview } from "@/lib/preview/guard";
import { ROUTES } from "@/lib/routes";
import { getTenantContext } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { readonly children: ReactNode }) {
  const tenant = await getTenantContext();
  if (tenant === null) {
    redirect(ROUTES.signIn);
  }

  const session = await getAuth().api.getSession({ headers: await headers() });
  const memberships = await findMembershipsByUserId(getDb(), tenant.userId);

  // The bell is in the layout on every page, so its read is the highest-blast-radius one in
  // the app: a fault here renders no bell and an intact shell, never a broken page (D5).
  let bell: BellViewModel | null = null;
  try {
    const snapshot = await readBellSnapshot(getDb(), tenant, { limit: 20, windowDays: 30 });
    bell = toBellViewModel(snapshot, new Date());
  } catch {
    bell = null;
  }

  return (
    <>
      {/* Beside the data it invalidates: router.refresh() re-runs this layout, so the badge
          cannot freeze while a page below it updates. */}
      <LiveRefresh topics={["notifications"]} />
      <AppFrame
        groups={navGroupsFor(await viewerMaySeePreview())}
        viewer={{
          name: session?.user.name ?? null,
          email: session?.user.email ?? null,
          organizationName: tenant.organizationName,
        }}
        organizations={memberships.map((membership) => ({
          id: membership.organizationId,
          name: membership.organizationName,
        }))}
        activeOrganizationId={tenant.organizationId}
        role={tenant.role}
        bell={bell}
      >
        {children}
      </AppFrame>
    </>
  );
}
