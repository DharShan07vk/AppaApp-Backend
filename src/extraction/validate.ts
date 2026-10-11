import type { DraftBill } from './types.js';

const VALID_GST_BPS = new Set([0, 500, 1200, 1800, 2800]);
const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Authoritative server-side validation for an extracted bill draft.
 * Sets needsReview: true and reason on any field that fails mathematical or formatting checks.
 */
export function validateDraftInvoice(draft: DraftBill): DraftBill {
  const result: DraftBill = JSON.parse(JSON.stringify(draft)); // deep copy

  // 1. Supplier GSTIN format validation
  if (result.supplier.gstin.value) {
    const cleanGstin = result.supplier.gstin.value.trim().toUpperCase();
    result.supplier.gstin.value = cleanGstin;
    if (!GSTIN_REGEX.test(cleanGstin)) {
      result.supplier.gstin.needsReview = true;
      result.supplier.gstin.reason = 'Please verify this value (Invalid GSTIN format)';
    }
  } else {
    result.supplier.gstin.needsReview = true;
    result.supplier.gstin.reason = 'Please verify this value (Missing GSTIN)';
  }

  // 2. Invoice Date validation (valid format and not in the future)
  if (result.invoiceDate.value) {
    const dateStr = result.invoiceDate.value;
    const parsedDate = new Date(dateStr);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (isNaN(parsedDate.getTime())) {
      result.invoiceDate.needsReview = true;
      result.invoiceDate.reason = 'Please verify this value (Invalid date format)';
    } else if (parsedDate > today) {
      result.invoiceDate.needsReview = true;
      result.invoiceDate.reason = 'Please verify this value (Invoice date cannot be in future)';
    }
  } else {
    result.invoiceDate.needsReview = true;
    result.invoiceDate.reason = 'Please verify this value (Missing invoice date)';
  }

  // 3. Invoice Number validation
  if (!result.invoiceNumber.value || result.invoiceNumber.value.trim().length === 0) {
    result.invoiceNumber.needsReview = true;
    result.invoiceNumber.reason = 'Please verify this value (Missing invoice number)';
  }

  // 4. Line items validation
  let sumItemTaxablePaise = 0;
  let sumItemCgstPaise = 0;
  let sumItemSgstPaise = 0;
  let sumItemIgstPaise = 0;

  for (const item of result.items) {
    // Missing name
    if (!item.name.value || item.name.value.trim().length === 0) {
      item.name.needsReview = true;
      item.name.reason = 'Please verify this value (Part name required)';
    }

    // Rate validation
    if (item.ratePaise.value === null || item.ratePaise.value <= 0) {
      item.ratePaise.needsReview = true;
      item.ratePaise.reason = 'Please verify this value (Rate must be greater than zero)';
    }

    // Quantity validation
    if (item.quantity.value === null || item.quantity.value <= 0) {
      item.quantity.needsReview = true;
      item.quantity.reason = 'Please verify this value (Quantity must be at least 1)';
    }

    // GST rate validation (allowed bps: 0, 500, 1200, 1800, 2800)
    const gstBps = item.gstBps.value ?? 1800;
    if (!VALID_GST_BPS.has(gstBps)) {
      item.gstBps.needsReview = true;
      item.gstBps.reason = `Please verify this value (Unusual GST rate ${(gstBps / 100).toFixed(0)}%)`;
    }

    // Taxable math check: qty * rate * (1 - discount%)
    if (item.quantity.value && item.ratePaise.value !== null) {
      const qty = item.quantity.value;
      const rate = item.ratePaise.value;
      const discountBps = item.discountBps.value ?? 0;

      const grossPaise = qty * rate;
      const discountPaise = Math.round((grossPaise * discountBps) / 10000);
      const expectedTaxable = grossPaise - discountPaise;

      if (item.taxablePaise.value !== null) {
        // Tolerance Rs 0.05 = 5 paise
        if (Math.abs(item.taxablePaise.value - expectedTaxable) > 5) {
          item.taxablePaise.needsReview = true;
          item.taxablePaise.reason = `Please verify this value (Math mismatch: expected ₹${(expectedTaxable / 100).toFixed(2)})`;
        }
      } else {
        item.taxablePaise.value = expectedTaxable;
      }

      const taxable = item.taxablePaise.value ?? expectedTaxable;
      sumItemTaxablePaise += taxable;

      // Calculate taxes if not set
      const totalTaxPaise = Math.round((taxable * gstBps) / 10000);
      sumItemCgstPaise += Math.round(totalTaxPaise / 2);
      sumItemSgstPaise += totalTaxPaise - Math.round(totalTaxPaise / 2);
    }
  }

  // 5. Total taxable check
  if (result.taxableTotalPaise.value !== null) {
    if (Math.abs(result.taxableTotalPaise.value - sumItemTaxablePaise) > 10) {
      result.taxableTotalPaise.needsReview = true;
      result.taxableTotalPaise.reason = `Please verify this value (Sum of lines ₹${(sumItemTaxablePaise / 100).toFixed(2)})`;
    }
  } else {
    result.taxableTotalPaise.value = sumItemTaxablePaise;
  }

  // 6. Grand total check
  const taxable = result.taxableTotalPaise.value ?? sumItemTaxablePaise;
  const cgst = result.cgstPaise.value ?? sumItemCgstPaise;
  const sgst = result.sgstPaise.value ?? sumItemSgstPaise;
  const igst = result.igstPaise.value ?? sumItemIgstPaise;
  const roundOff = result.roundOffPaise.value ?? 0;
  const expectedGrandTotal = taxable + cgst + sgst + igst + roundOff;

  if (result.totalAmountPaise.value !== null) {
    if (Math.abs(result.totalAmountPaise.value - expectedGrandTotal) > 10) {
      result.totalAmountPaise.needsReview = true;
      result.totalAmountPaise.reason = `Please verify this value (Reconciled total ₹${(expectedGrandTotal / 100).toFixed(2)})`;
    }
  } else {
    result.totalAmountPaise.value = expectedGrandTotal;
  }

  return result;
}
