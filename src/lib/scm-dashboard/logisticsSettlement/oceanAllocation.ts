import type {
  GlobalMoveLine,
  OceanAllocationResult,
  OceanAllocationRow,
  OceanAllocationWarning,
  OceanSettlementLine,
  SkuMaster,
  UnitPrice,
} from "./types";

type AllocateOceanSettlementArgs = {
  moves: GlobalMoveLine[];
  settlement: OceanSettlementLine[];
  skuMasters: SkuMaster[];
  unitPrices: UnitPrice[];
};

function normalize(value: string) {
  return value.trim().toUpperCase();
}

function settlementMonthOf(value: string | null) {
  return value ? value.slice(0, 7) : "";
}

function countryFromWarehouse(value: string) {
  const normalized = normalize(value);
  if (normalized.startsWith("KR") || normalized.includes("KOREA") || normalized.includes("태광") || normalized.includes("디자인")) return "KR";
  if (normalized.startsWith("US") || normalized.includes("AMZUS") || normalized.includes("USA")) return "US";
  return normalized;
}

function mode(values: number[]) {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let bestValue = 0;
  let bestCount = -1;
  for (const [value, count] of Array.from(counts.entries())) {
    if (count > bestCount || (count === bestCount && value > bestValue)) {
      bestValue = value;
      bestCount = count;
    }
  }
  return bestValue;
}

function allocateRoundedTotal(total: number, basis: number[]) {
  const roundedTotal = Math.round(total);
  if (!basis.length) return [];

  const positiveBasis = basis.map((value) => Math.max(0, Number.isFinite(value) ? value : 0));
  const basisTotal = positiveBasis.reduce((sum, value) => sum + value, 0);

  if (basisTotal <= 0) {
    const base = Math.floor(roundedTotal / basis.length);
    const out = new Array<number>(basis.length).fill(base);
    let remainder = roundedTotal - base * basis.length;
    for (let index = 0; index < out.length && remainder > 0; index += 1, remainder -= 1) {
      out[index] += 1;
    }
    return out;
  }

  const raw = positiveBasis.map((value) => (roundedTotal * value) / basisTotal);
  const allocated = raw.map(Math.floor);
  let remainder = roundedTotal - allocated.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  let cursor = 0;
  while (remainder > 0 && order.length > 0) {
    allocated[order[cursor].index] += 1;
    remainder -= 1;
    cursor = (cursor + 1) % order.length;
  }

  return allocated;
}

function divideByQty(value: number, qty: number) {
  return qty > 0 ? value / qty : 0;
}

export function allocateOceanSettlement({
  moves,
  settlement,
  skuMasters,
  unitPrices,
}: AllocateOceanSettlementArgs): OceanAllocationResult {
  const warnings: OceanAllocationWarning[] = [];
  const weightKgBySku = new Map(
    skuMasters.map((row) => [row.resourceCode, Math.max(0, row.skuWeightG) / 1000]),
  );
  const priceByRouteSku = new Map(
    unitPrices.map((row) => [
      `${normalize(row.fromCountry)}|${normalize(row.toCountry)}|${row.resourceCode}`,
      Math.max(0, row.proposalUnitPriceUsd),
    ]),
  );
  const priceBySku = new Map(
    unitPrices.map((row) => [row.resourceCode, Math.max(0, row.proposalUnitPriceUsd)]),
  );

  const settlementByBl = new Map<string, OceanSettlementLine[]>();
  for (const line of settlement) {
    if (!line.blNo) continue;
    const rows = settlementByBl.get(line.blNo) ?? [];
    rows.push(line);
    settlementByBl.set(line.blNo, rows);
  }

  const movesByBl = new Map<string, GlobalMoveLine[]>();
  for (const move of moves) {
    if (move.carrierMode !== "해상") continue;
    if (!move.blNo) {
      warnings.push({
        code: "NO_BL",
        blNo: "",
        resourceCode: move.resourceCode,
        message: `No BL for sourceLineId=${move.sourceLineId}`,
      });
      continue;
    }
    const rows = movesByBl.get(move.blNo) ?? [];
    rows.push(move);
    movesByBl.set(move.blNo, rows);
  }

  const rows: OceanAllocationRow[] = [];

  for (const [blNo, blMoves] of Array.from(movesByBl.entries())) {
    const blSettlement = settlementByBl.get(blNo) ?? [];
    if (!blSettlement.length) {
      warnings.push({
        code: "NO_SETTLEMENT_LINES",
        blNo,
        message: `No ocean settlement rows for BL=${blNo}`,
      });
      continue;
    }

    const representativeFx = mode(blSettlement.map((line) => line.exrate));
    let freightKrw = 0;
    let dutyKrw = 0;
    let otherKrw = 0;
    let latestInvoiceDate = "";
    const containerType = blSettlement.find((line) => line.containerType)?.containerType ?? "";

    for (const line of blSettlement) {
      if (line.invoiceDate && line.invoiceDate > latestInvoiceDate) latestInvoiceDate = line.invoiceDate;
      const country = normalize(line.country);
      const chargeType = normalize(line.chargeType);

      if (chargeType === "DUTY") {
        dutyKrw += line.amountOrig && representativeFx ? line.amountOrig * representativeFx : 0;
        continue;
      }

      const lineKrw = line.amountKrw + line.taxKrw;
      if (country === "KR" && (chargeType === "OCEAN" || chargeType === "TRUCKING")) {
        freightKrw += lineKrw;
      } else if (country === "US" && chargeType === "TRUCKING") {
        freightKrw += lineKrw;
      } else {
        otherKrw += lineKrw;
      }
    }

    const allocationInputs = blMoves.map((move) => {
      const weightKg = weightKgBySku.get(move.resourceCode) ?? 0;
      if (weightKg <= 0) {
        warnings.push({
          code: "MISSING_SKU_WEIGHT",
          blNo,
          resourceCode: move.resourceCode,
          message: `Missing SKU weight for ${move.resourceCode}`,
        });
      }

      const fromCountry = countryFromWarehouse(move.fromWarehouse);
      const toCountry = countryFromWarehouse(move.toWarehouse);
      const unitPrice =
        priceByRouteSku.get(`${fromCountry}|${toCountry}|${move.resourceCode}`) ??
        priceBySku.get(move.resourceCode) ??
        0;

      if (unitPrice <= 0) {
        warnings.push({
          code: "MISSING_UNIT_PRICE",
          blNo,
          resourceCode: move.resourceCode,
          message: `Missing unit price for ${move.resourceCode}`,
        });
      }

      return {
        move,
        weightBasis: move.qtyEa * weightKg,
        declaredValueBasis: move.qtyEa * unitPrice,
        unitPrice,
      };
    });

    let freightBasis = allocationInputs.map((row) => row.weightBasis);
    if (freightBasis.reduce((sum, value) => sum + value, 0) <= 0) {
      freightBasis = allocationInputs.map((row) => row.move.qtyEa);
      warnings.push({
        code: "FALLBACK_QTY_WEIGHT",
        blNo,
        message: `Fallback to qty basis for freight/other on BL=${blNo}`,
      });
    }

    const knownValue = allocationInputs.reduce(
      (sum, row) => sum + (row.unitPrice > 0 ? row.move.qtyEa * row.unitPrice : 0),
      0,
    );
    const knownQty = allocationInputs.reduce(
      (sum, row) => sum + (row.unitPrice > 0 ? row.move.qtyEa : 0),
      0,
    );
    const averageUnitPrice = knownQty > 0 ? knownValue / knownQty : 0;

    let dutyBasis = allocationInputs.map((row) => {
      const unitPrice = row.unitPrice || averageUnitPrice;
      return row.move.qtyEa * unitPrice;
    });
    if (dutyBasis.reduce((sum, value) => sum + value, 0) <= 0) {
      dutyBasis = allocationInputs.map((row) => row.move.qtyEa);
      warnings.push({
        code: "FALLBACK_QTY_DUTY",
        blNo,
        message: `Fallback to qty basis for duty on BL=${blNo}`,
      });
    }

    const freightAllocations = allocateRoundedTotal(freightKrw, freightBasis);
    const otherAllocations = allocateRoundedTotal(otherKrw, freightBasis);
    const dutyAllocations = allocateRoundedTotal(dutyKrw, dutyBasis);
    const totalFreightBasis = freightBasis.reduce((sum, value) => sum + value, 0) || 1;
    const totalDutyBasis = dutyBasis.reduce((sum, value) => sum + value, 0) || 1;

    allocationInputs.forEach(({ move }, index) => {
      const skuFreightKrw = freightAllocations[index] ?? 0;
      const skuDutyKrw = dutyAllocations[index] ?? 0;
      const skuOtherKrw = otherAllocations[index] ?? 0;
      const skuTotalKrw = skuFreightKrw + skuDutyKrw + skuOtherKrw;

      rows.push({
        rawKey: `ocean_v1:${move.sourceLineId}`,
        sourceLineId: move.sourceLineId,
        invoiceNo: move.invoiceNo,
        blNo,
        carrier: move.carrier,
        carrierMode: "해상",
        shipDate: move.shipDate,
        settlementMonth: settlementMonthOf(latestInvoiceDate),
        fromWarehouse: move.fromWarehouse,
        toWarehouse: move.toWarehouse,
        resourceCode: move.resourceCode,
        resourceName: move.resourceName,
        qtyEa: move.qtyEa,
        qtyCtn: move.qtyCtn,
        weightRatioPct: (freightBasis[index] / totalFreightBasis) * 100,
        valueRatioPct: (dutyBasis[index] / totalDutyBasis) * 100,
        invoiceTotalLogisticsKrw: Math.round(freightKrw + dutyKrw + otherKrw),
        invoiceTotalFreightKrw: Math.round(freightKrw),
        invoiceTotalDutyKrw: Math.round(dutyKrw),
        invoiceTotalOtherKrw: Math.round(otherKrw),
        skuLogisticsAllocKrw: skuTotalKrw,
        skuLogisticsUnitKrw: divideByQty(skuTotalKrw, move.qtyEa),
        skuFreightUnitKrw: divideByQty(skuFreightKrw, move.qtyEa),
        skuDutyUnitKrw: divideByQty(skuDutyKrw, move.qtyEa),
        skuOtherUnitKrw: divideByQty(skuOtherKrw, move.qtyEa),
        containerType,
        allocationRuleVersion: "ocean_v1",
      });
    });
  }

  return { rows, warnings };
}
