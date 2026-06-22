import OceanSettlementClient from "./ocean/OceanSettlementClient";

import { getAuthenticatedUser, toUserSummary } from "@/lib/scm-dashboard/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { user, error } = await getAuthenticatedUser();

  return (
    <OceanSettlementClient
      initialAuthError={error}
      user={user ? toUserSummary(user) : null}
    />
  );
}
