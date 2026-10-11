export interface ReviewableField<T> {
  value: T | null;
  needsReview: boolean;
  reason?: string;
}

export interface DraftBillItem {
  name: ReviewableField<string>;
  partNumber: ReviewableField<string>;
  hsn: ReviewableField<string>;
  quantity: ReviewableField<number>;
  unit: ReviewableField<string>;
  ratePaise: ReviewableField<number>;
  discountBps: ReviewableField<number>;
  gstBps: ReviewableField<number>;
  taxablePaise: ReviewableField<number>;
  lineTotalPaise: ReviewableField<number>;
}

export interface DraftBill {
  supplier: {
    name: ReviewableField<string>;
    address: ReviewableField<string>;
    gstin: ReviewableField<string>;
    phone: ReviewableField<string>;
  };
  invoiceNumber: ReviewableField<string>;
  invoiceDate: ReviewableField<string>;
  placeOfSupply: ReviewableField<string>;
  paymentTerms: ReviewableField<string>;
  items: DraftBillItem[];
  taxableTotalPaise: ReviewableField<number>;
  cgstPaise: ReviewableField<number>;
  sgstPaise: ReviewableField<number>;
  igstPaise: ReviewableField<number>;
  roundOffPaise: ReviewableField<number>;
  totalAmountPaise: ReviewableField<number>;
  amountInWords: ReviewableField<string>;
}

export interface InvoiceExtractor {
  extractInvoice(imageBuffer: Buffer, mimeType: string): Promise<DraftBill>;
}
