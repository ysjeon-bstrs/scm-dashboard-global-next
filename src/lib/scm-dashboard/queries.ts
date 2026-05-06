import type { SupabaseClient } from "@supabase/supabase-js";

import { INVENTORY_SNAPSHOT_TABLE, LOGISTICS_MOVES_TABLE } from "./constants";
import type { InventorySnapshotRow, MoveRow } from "./types";

export async function fetchInventorySnapshots(supabase: SupabaseClient) {
  if (!INVENTORY_SNAPSHOT_TABLE) {
    return {
      rows: [] as InventorySnapshotRow[],
      notice: "SCM_INVENTORY_SNAPSHOT_TABLE env is not set.",
    };
  }

  const { data, error } = await supabase
    .from(INVENTORY_SNAPSHOT_TABLE)
    .select("*")
    .limit(5000);

  if (error) {
    throw new Error(error.message);
  }

  return { rows: (data ?? []) as InventorySnapshotRow[], notice: null };
}

export async function fetchLogisticsMoves(supabase: SupabaseClient) {
  if (!LOGISTICS_MOVES_TABLE) {
    return {
      rows: [] as MoveRow[],
      notice: "SCM_LOGISTICS_MOVES_TABLE env is not set.",
    };
  }

  const { data, error } = await supabase
    .from(LOGISTICS_MOVES_TABLE)
    .select("*")
    .limit(5000);

  if (error) {
    throw new Error(error.message);
  }

  return { rows: (data ?? []) as MoveRow[], notice: null };
}
