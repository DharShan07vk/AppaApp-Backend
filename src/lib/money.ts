/**
 * SpareTrack Backend — Shared Money & GST Module
 * Identical to lib/money.ts in the mobile app.
 * Both must stay in sync. The server result is authoritative.
 */

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

export function formatMoney(paise: number): string {
  const rupees = Math.round(paise) / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

const ALLOWED_GST_RATES = new Set([0, 5, 12, 18, 28]);

export function isValidGstRate(rate: number): boolean {
  return ALLOWED_GST_RATES.has(rate);
}

export interface LineCalcInput {
  quantity: number;
  ratePaise: number;
  discountBps: number;
  gstBps: number;
  isInterState: boolean;
}

export interface LineCalcResult {
  grossPaise: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalTaxPaise: number;
  lineTotalPaise: number;
}

export function calculateLine(input: LineCalcInput): LineCalcResult {
  const { quantity, ratePaise, discountBps, gstBps, isInterState } = input;
  const grossPaise = Math.round(quantity * ratePaise);
  const discountPaise = Math.round(grossPaise * discountBps / 10000);
  const taxablePaise = grossPaise - discountPaise;
  const totalTaxPaise = Math.round(taxablePaise * gstBps / 10000);
  let cgstPaise = 0, sgstPaise = 0, igstPaise = 0;
  if (isInterState) {
    igstPaise = totalTaxPaise;
  } else {
    cgstPaise = Math.floor(totalTaxPaise / 2);
    sgstPaise = totalTaxPaise - cgstPaise;
  }
  return { grossPaise, discountPaise, taxablePaise, cgstPaise, sgstPaise, igstPaise, totalTaxPaise, lineTotalPaise: taxablePaise + totalTaxPaise };
}

export interface BillTotals {
  taxableTotalPaise: number;
  cgstTotalPaise: number;
  sgstTotalPaise: number;
  igstTotalPaise: number;
  totalTaxPaise: number;
  grandTotalBeforeRoundOff: number;
  roundOffPaise: number;
  grandTotalPaise: number;
}

export function calculateBillTotals(lines: LineCalcResult[]): BillTotals {
  const taxableTotalPaise = lines.reduce((s, l) => s + l.taxablePaise, 0);
  const cgstTotalPaise = lines.reduce((s, l) => s + l.cgstPaise, 0);
  const sgstTotalPaise = lines.reduce((s, l) => s + l.sgstPaise, 0);
  const igstTotalPaise = lines.reduce((s, l) => s + l.igstPaise, 0);
  const totalTaxPaise = cgstTotalPaise + sgstTotalPaise + igstTotalPaise;
  const grandTotalBeforeRoundOff = taxableTotalPaise + totalTaxPaise;
  const grandTotalPaise = Math.round(grandTotalBeforeRoundOff / 100) * 100;
  const roundOffPaise = grandTotalPaise - grandTotalBeforeRoundOff;
  return { taxableTotalPaise, cgstTotalPaise, sgstTotalPaise, igstTotalPaise, totalTaxPaise, grandTotalBeforeRoundOff, roundOffPaise, grandTotalPaise };
}

export function isInterState(supplierGstin: string | null | undefined, buyerStateCode: string | null | undefined): boolean {
  if (supplierGstin && buyerStateCode) {
    return supplierGstin.slice(0, 2) !== buyerStateCode.slice(0, 2);
  }
  return false;
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function formatRupees(paise: number): string {
  return formatMoney(paise);
}

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}
