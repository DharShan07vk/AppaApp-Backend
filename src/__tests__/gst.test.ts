import { describe, it, expect } from 'vitest';
import {
  rupeesToPaise,
  paiseToRupees,
  formatRupees,
  calculateLine,
  calculateBillTotals,
  isInterState,
  bpsToPercent,
  percentToBps,
} from '../lib/money.js';

describe('GST Calculation & Money Module (Worked Example & Rules)', () => {
  it('converts rupees to paise and back accurately', () => {
    expect(rupeesToPaise(3540)).toBe(354000);
    expect(rupeesToPaise(3469.2)).toBe(346920);
    expect(paiseToRupees(346920)).toBe(3469.2);
    expect(formatRupees(28462000)).toMatch(/2,84,620/);
  });

  it('matches the canonical worked example from the skill', () => {
    // 3540 @ 2% discount = 3469.20 taxable
    // 2240 @ 2% discount = 2195.20 taxable
    // Taxable total 5664.40. CGST 9% = 509.80, SGST 9% = 509.80. Total 6684.00.

    const line1 = calculateLine({
      quantity: 1,
      ratePaise: 354000,
      discountBps: 200, // 2%
      gstBps: 1800,     // 18% total (9% CGST + 9% SGST)
      isInterState: false,
    });

    expect(line1.taxablePaise).toBe(346920); // 3469.20
    expect(line1.cgstPaise).toBe(31223);    // 312.23 (9% of 3469.20 = 312.228 -> 312.23)
    expect(line1.sgstPaise).toBe(31223);    // 312.23
    expect(line1.igstPaise).toBe(0);

    const line2 = calculateLine({
      quantity: 1,
      ratePaise: 224000,
      discountBps: 200, // 2%
      gstBps: 1800,     // 18%
      isInterState: false,
    });

    expect(line2.taxablePaise).toBe(219520); // 2195.20
    expect(line2.cgstPaise).toBe(19757);    // 197.57 (9% of 2195.20 = 197.568 -> 197.57)
    expect(line2.sgstPaise).toBe(19757);
    expect(line2.igstPaise).toBe(0);

    const totals = calculateBillTotals([line1, line2]);

    expect(totals.taxableTotalPaise).toBe(566440); // 5664.40
    // CGST total: 312.23 + 197.57 = 509.80 (50980 paise)
    expect(totals.cgstTotalPaise).toBe(50980);
    // SGST total: 312.23 + 197.57 = 509.80 (50980 paise)
    expect(totals.sgstTotalPaise).toBe(50980);
    expect(totals.igstTotalPaise).toBe(0);

    // Grand total: 5664.40 + 509.80 + 509.80 = 6684.00 (668400 paise)
    expect(totals.grandTotalPaise).toBe(668400);
    expect(totals.roundOffPaise).toBe(0);
  });

  it('correctly calculates inter-state IGST instead of CGST/SGST', () => {
    const line = calculateLine({
      quantity: 2,
      ratePaise: 100000, // 1000.00
      discountBps: 0,
      gstBps: 1800,      // 18% IGST
      isInterState: true,
    });

    expect(line.taxablePaise).toBe(200000);
    expect(line.cgstPaise).toBe(0);
    expect(line.sgstPaise).toBe(0);
    expect(line.igstPaise).toBe(36000); // 360.00 (18% of 2000.00)
    expect(line.lineTotalPaise).toBe(236000);
  });

  it('detects intra vs inter state by comparing GSTIN first 2 state digits', () => {
    // 33 is Tamil Nadu
    // 29 is Karnataka
    expect(isInterState('33AAAAA0000A1Z5', 'Tamil Nadu')).toBe(false);
    expect(isInterState('29AAAAA0000A1Z5', 'Tamil Nadu')).toBe(true);
    expect(isInterState('33AAAAA0000A1Z5', '33')).toBe(false);
    expect(isInterState('29AAAAA0000A1Z5', '33')).toBe(true);
  });

  it('converts basis points and percentages correctly', () => {
    expect(bpsToPercent(1800)).toBe(18);
    expect(bpsToPercent(200)).toBe(2);
    expect(bpsToPercent(500)).toBe(5);
    expect(percentToBps(18)).toBe(1800);
    expect(percentToBps(2.5)).toBe(250);
  });
});
