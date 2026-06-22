import { getSupabaseRestEnv, supabaseGetAll } from "./supabaseRest";

export type OceanStagingStatusRow = {
  raw_key: string;
  invoice_date: string | null;
  bl_no: string;
  charge_type: string;
  amount_krw: number | string | null;
  tax_krw: number | string | null;
  file_id: string | null;
  file_name: string | null;
  updated_at: string | null;
};

export type OceanStagingStatusSummary = {
  rowCount: number;
  blCount: number;
  fileCount: number;
  latestUpdatedAt: string | null;
  months: string[];
  amountTotals: {
    amountKrw: number;
    taxKrw: number;
    byChargeType: Record<string, number>;
  };
};

export async function fetchOceanStagingStatus(): Promise<OceanStagingStatusSummary> {
  const env = getSupabaseRestEnv({ requireServiceRole: true });
  const params = new URLSearchParams({
    select: "raw_key,invoice_date,bl_no,charge_type,amount_krw,tax_krw,file_id,file_name,updated_at",
    order: "invoice_date.desc,bl_no.asc,raw_key.asc",
  });
  const rows = await supabaseGetAll<OceanStagingStatusRow>(env, "stg_settlement_ocean_lines", params);
  return summarizeOceanStagingRows(rows);
}

export function summarizeOceanStagingRows(rows: OceanStagingStatusRow[]): OceanStagingStatusSummary {
  const bls = new Set<string>();
  const files = new Set<string>();
  const months = new Set<string>();
  const byChargeType: Record<string, number> = {};
  let amountKrw = 0;
  let taxKrw = 0;
  let latestUpdatedAt: string | null = null;

  for (const row of rows) {
    if (row.bl_no) bls.add(row.bl_no);
    const fileKey = row.file_id || row.file_name || "";
    if (fileKey) files.add(fileKey);
    if (row.invoice_date) months.add(row.invoice_date.slice(0, 7));
    const rowAmount = numberValue(row.amount_krw);
    const rowTax = numberValue(row.tax_krw);
    amountKrw += rowAmount;
    taxKrw += rowTax;
    const chargeType = row.charge_type || "UNKNOWN";
    byChargeType[chargeType] = (byChargeType[chargeType] ?? 0) + rowAmount;
    if (row.updated_at && (!latestUpdatedAt || row.updated_at > latestUpdatedAt)) {
      latestUpdatedAt = row.updated_at;
    }
  }

  return {
    rowCount: rows.length,
    blCount: bls.size,
    fileCount: files.size,
    latestUpdatedAt,
    months: Array.from(months).sort(),
    amountTotals: { amountKrw, taxKrw, byChargeType },
  };
}

function numberValue(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
