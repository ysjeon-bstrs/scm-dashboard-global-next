import type { User } from "@supabase/supabase-js";

import { ALLOWED_EMAIL_DOMAIN } from "./constants";
import { createServerSupabaseClient } from "./supabaseClient";
import type { UserSummary } from "./types";

export function isAllowedEmail(email: string | undefined | null) {
  return Boolean(email?.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN}`));
}

export function toUserSummary(user: User): UserSummary {
  return { email: user.email ?? "" };
}

export async function getAuthenticatedUser() {
  let supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;

  try {
    supabase = await createServerSupabaseClient();
  } catch {
    return { user: null, error: "unauthenticated" as const };
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, error: "unauthenticated" as const };
  }

  if (!isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return { user: null, error: "forbidden-domain" as const };
  }

  return { user, error: null };
}
