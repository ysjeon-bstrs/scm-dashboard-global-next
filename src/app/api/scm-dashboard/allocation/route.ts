import { NextResponse } from "next/server";

import { calculateAllocation } from "@/lib/scm-dashboard/allocation";
import { getAuthenticatedUser } from "@/lib/scm-dashboard/auth";
import { parseAllocationWorkbook } from "@/lib/scm-dashboard/excel";
import { fetchInventorySnapshots } from "@/lib/scm-dashboard/queries";
import { createServerSupabaseClient } from "@/lib/scm-dashboard/supabaseClient";

export async function POST(request: Request) {
  const auth = await getAuthenticatedUser();

  if (auth.error === "unauthenticated") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (auth.error === "forbidden-domain") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing Excel file." }, { status: 400 });
  }

  try {
    const supabase = await createServerSupabaseClient();
    const uploadRows = await parseAllocationWorkbook(file);
    const inventoryResult = await fetchInventorySnapshots(supabase);
    const rows = calculateAllocation(uploadRows, inventoryResult.rows);

    return NextResponse.json({
      rows,
      notices: [inventoryResult.notice].filter(Boolean),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
