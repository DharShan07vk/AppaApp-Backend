import { describe, it, expect } from 'vitest';
import { validateDraftInvoice } from '../extraction/validate.js';
import type { DraftBill } from '../extraction/types.js';

function createMockDraft(overrides?: Partial<DraftBill>): DraftBill {
  return {
    supplier: {
      name: { value: 'Kishindas Auto Parts', needsReview: false },
      address: { value: '123 Anna Salai, Chennai', needsReview: false },
      gstin: { value: '33AABCK1234F1Z8', needsReview: false }, // Valid TN GSTIN
      phone: { value: '9840012345', needsReview: false },
    },
    invoiceNumber: { value: 'CHE/25-2773989', needsReview: false },
    invoiceDate: { value: '2025-01-15', needsReview: false },
    placeOfSupply: { value: 'Tamil Nadu', needsReview: false },
    paymentTerms: { value: 'Credit 30 Days', needsReview: false },
    items: [
      {
        name: { value: 'XCENT/110 KAPP 1.2L ENGINE KIT', needsReview: false },
        partNumber: { value: '21100-04000', needsReview: false },
        hsn: { value: '8708', needsReview: false },
        quantity: { value: 1, needsReview: false },
        unit: { value: 'NOS', needsReview: false },
        ratePaise: { value: 354000, needsReview: false }, // 3540.00
        discountBps: { value: 200, needsReview: false },  // 2%
        gstBps: { value: 1800, needsReview: false },      // 18%
        taxablePaise: { value: 346920, needsReview: false }, // 3469.20
        lineTotalPaise: { value: 409366, needsReview: false },
      },
      {
        name: { value: 'TATA ACE KIT', needsReview: false },
        partNumber: { value: '2525-0112', needsReview: false },
        hsn: { value: '8708', needsReview: false },
        quantity: { value: 1, needsReview: false },
        unit: { value: 'NOS', needsReview: false },
        ratePaise: { value: 224000, needsReview: false }, // 2240.00
        discountBps: { value: 200, needsReview: false },  // 2%
        gstBps: { value: 1800, needsReview: false },      // 18%
        taxablePaise: { value: 219520, needsReview: false }, // 2195.20
        lineTotalPaise: { value: 259034, needsReview: false },
      },
    ],
    taxableTotalPaise: { value: 566440, needsReview: false }, // 5664.40
    cgstPaise: { value: 50980, needsReview: false },         // 509.80
    sgstPaise: { value: 50980, needsReview: false },         // 509.80
    igstPaise: { value: 0, needsReview: false },
    roundOffPaise: { value: 0, needsReview: false },
    totalAmountPaise: { value: 668400, needsReview: false },  // 6684.00
    amountInWords: { value: 'Rupees Six Thousand Six Hundred Eighty Four Only', needsReview: false },
    ...overrides,
  };
}

describe('Authoritative Extraction Validation', () => {
  it('validates a mathematically correct draft invoice with zero review flags', () => {
    const draft = createMockDraft();
    const result = validateDraftInvoice(draft);

    expect(result.supplier.gstin.needsReview).toBe(false);
    expect(result.invoiceDate.needsReview).toBe(false);
    expect(result.items[0].taxablePaise.needsReview).toBe(false);
    expect(result.items[1].taxablePaise.needsReview).toBe(false);
    expect(result.taxableTotalPaise.needsReview).toBe(false);
    expect(result.totalAmountPaise.needsReview).toBe(false);
  });

  it('flags needsReview on math mismatch in line taxable calculation exceeding tolerance', () => {
    const draft = createMockDraft();
    // Tamper line taxable: rate is 3540 @ 2% discount (3469.20), but draft states 3100.00
    draft.items[0].taxablePaise.value = 310000;

    const result = validateDraftInvoice(draft);
    expect(result.items[0].taxablePaise.needsReview).toBe(true);
    expect(result.items[0].taxablePaise.reason).toContain('Please verify this value');
  });

  it('flags needsReview on invalid GSTIN format', () => {
    const draft = createMockDraft();
    draft.supplier.gstin.value = 'INVALID_GSTIN_123';

    const result = validateDraftInvoice(draft);
    expect(result.supplier.gstin.needsReview).toBe(true);
    expect(result.supplier.gstin.reason).toContain('Invalid GSTIN format');
  });

  it('flags needsReview when invoice date is in the future', () => {
    const draft = createMockDraft();
    draft.invoiceDate.value = '2099-12-31';

    const result = validateDraftInvoice(draft);
    expect(result.invoiceDate.needsReview).toBe(true);
    expect(result.invoiceDate.reason).toContain('future');
  });

  it('flags needsReview on non-standard GST rate', () => {
    const draft = createMockDraft();
    draft.items[0].gstBps.value = 1500; // 15% is not a valid standard Indian GST slab (0, 5, 12, 18, 28)

    const result = validateDraftInvoice(draft);
    expect(result.items[0].gstBps.needsReview).toBe(true);
    expect(result.items[0].gstBps.reason).toContain('Unusual GST rate');
  });

  it('flags needsReview when total amount does not reconcile with taxable and tax sums', () => {
    const draft = createMockDraft();
    draft.totalAmountPaise.value = 999900; // Wrong total

    const result = validateDraftInvoice(draft);
    expect(result.totalAmountPaise.needsReview).toBe(true);
    expect(result.totalAmountPaise.reason).toContain('Reconciled total');
  });
});
