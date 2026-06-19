import AmazonStockClient from "./AmazonStockClient";

import { getAuthenticatedUser, toUserSummary } from "@/lib/scm-dashboard/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { user, error } = await getAuthenticatedUser();

  return <AmazonStockClient initialAuthError={error} user={user ? toUserSummary(user) : null} />;
}
