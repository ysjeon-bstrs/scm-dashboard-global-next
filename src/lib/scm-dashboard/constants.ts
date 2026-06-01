export const API_PREFIX = process.env.NEXT_PUBLIC_API_PREFIX ?? "/api";

export const SCM_DASHBOARD_API_PATH = `${API_PREFIX}/scm-dashboard`;
export const SCM_DASHBOARD_ALLOCATION_API_PATH = `${SCM_DASHBOARD_API_PATH}/allocation`;
export const SCM_DASHBOARD_CJ_LOT_STOCK_API_PATH = `${SCM_DASHBOARD_API_PATH}/cj-lot-stock`;
export const SCM_DASHBOARD_CJ_ALLOCATION_API_PATH = `${SCM_DASHBOARD_API_PATH}/cj-allocation`;

export const ALLOWED_EMAIL_DOMAIN =
  process.env.NEXT_PUBLIC_ALLOWED_DOMAIN ?? "boosters.kr";

export const INVENTORY_SNAPSHOT_TABLE =
  process.env.SCM_INVENTORY_SNAPSHOT_TABLE ?? "";

export const LOGISTICS_MOVES_TABLE = process.env.SCM_LOGISTICS_MOVES_TABLE ?? "";

export const GLOBAL_CENTER_CODES = [
  "AMZUS",
  "SBSMY",
  "SBSSG",
  "SBSTH",
  "SBSPH",
] as const;
