export type GlobalMoveLine = {
  sourceLineId: number;
  invoiceNo: string;
  carrier: string;
  carrierMode: string;
  shipDate: string | null;
  fromWarehouse: string;
  toWarehouse: string;
  resourceCode: string;
  resourceName: string;
  qtyEa: number;
  qtyCtn: number;
  unitPriceUsd: number;
  amountUsd: number;
  blNo: string;
};

export type OceanSettlementLine = {
  rawKey: string;
  invoiceDate: string | null;
  blNo: string;
  country: string;
  chargeType: string;
  currency: string;
  amountOrig: number;
  exrate: number;
  amountKrw: number;
  taxKrw: number;
  containerType: string;
  fileName: string;
  fileId: string;
};

export type SkuMaster = {
  resourceCode: string;
  skuWeightG: number;
};

export type UnitPrice = {
  fromCountry: string;
  toCountry: string;
  resourceCode: string;
  proposalUnitPriceUsd: number;
};

export type OceanAllocationRow = {
  rawKey: string;
  sourceLineId: number;
  invoiceNo: string;
  blNo: string;
  carrier: string;
  carrierMode: "해상";
  shipDate: string | null;
  settlementMonth: string;
  fromWarehouse: string;
  toWarehouse: string;
  resourceCode: string;
  resourceName: string;
  qtyEa: number;
  qtyCtn: number;
  weightRatioPct: number;
  valueRatioPct: number;
  invoiceTotalLogisticsKrw: number;
  invoiceTotalFreightKrw: number;
  invoiceTotalDutyKrw: number;
  invoiceTotalOtherKrw: number;
  skuLogisticsAllocKrw: number;
  skuLogisticsUnitKrw: number;
  skuFreightUnitKrw: number;
  skuDutyUnitKrw: number;
  skuOtherUnitKrw: number;
  containerType: string;
  allocationRuleVersion: "ocean_v1";
};

export type OceanAllocationWarning = {
  code:
    | "NO_SETTLEMENT_LINES"
    | "MISSING_SKU_WEIGHT"
    | "MISSING_UNIT_PRICE"
    | "NO_BL"
    | "FALLBACK_QTY_WEIGHT"
    | "FALLBACK_QTY_DUTY";
  blNo: string;
  resourceCode?: string;
  message: string;
};

export type OceanAllocationResult = {
  rows: OceanAllocationRow[];
  warnings: OceanAllocationWarning[];
};
