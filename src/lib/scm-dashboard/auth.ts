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
    // Do NOT signOut() here: this helper runs during Server Component render,
    // where cookie writes are silently swallowed (see supabaseClient setAll),
    // so the "sign out" never actually lands and only mutates remote session
    // state mid-render. Every gate re-checks the domain, so simply reporting
    // forbidden-domain is safe; real sign-out happens via POST /api/auth/signout.
    return { user: null, error: "forbidden-domain" as const };
  }

  return { user, error: null };
}
