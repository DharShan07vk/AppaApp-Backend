import { z } from 'zod';

// ─── Auth schemas ──────────────────────────────────────────────────────────
export const RegisterSchema = z.object({
  shopName: z.string().min(2).max(100),
  ownerName: z.string().min(2).max(100),
  gstin: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}\d{1}Z[A-Z\d]{1}$/, 'Invalid GSTIN format').optional().or(z.literal('')),
  state: z.string().min(2).max(50).default('Tamil Nadu'),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// ─── Bill item schemas ─────────────────────────────────────────────────────
const GST_RATES = [0, 500, 1200, 1800, 2800] as const;  // bps

export const BillItemInputSchema = z.object({
  name: z.string().min(1).max(255),
  partNumber: z.string().max(100).default(''),
  hsn: z.string().max(20).default(''),
  quantity: z.number().positive().max(100000),
  ratePaise: z.number().int().positive(),
  discountBps: z.number().int().min(0).max(9999).default(0),
  gstBps: z.number().int().refine(
    (v) => [0, 500, 1200, 1800, 2800].includes(v),
    { message: 'GST must be 0, 5, 12, 18, or 28%' },
  ),
  partId: z.string().optional().nullable(),
});

export type BillItemInput = z.infer<typeof BillItemInputSchema>;

// ─── Bill schemas ──────────────────────────────────────────────────────────
export const CreateBillSchema = z.object({
  supplierName: z.string().min(1).max(255),
  supplierGstin: z.string().max(15).default(''),
  supplierAddress: z.string().max(500).default(''),
  supplierId: z.string().optional().nullable(),
  invoiceNumber: z.string().min(1).max(100),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  placeOfSupply: z.string().min(2).max(100).default('Tamil Nadu'),
  paymentTerms: z.string().max(100).default('Credit'),
  items: z.array(BillItemInputSchema).min(1).max(200),
  syncClientId: z.string().min(1).max(128),
});

export type CreateBillInput = z.infer<typeof CreateBillSchema>;

export const UpdateBillSchema = CreateBillSchema.partial().omit({ syncClientId: true });

// ─── Search schemas ────────────────────────────────────────────────────────
export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  sort: z.enum(['date_desc', 'date_asc', 'amount_desc', 'amount_asc']).default('date_desc'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

// ─── Extraction schemas ────────────────────────────────────────────────────
export const ExtractionMetaSchema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
});

// ─── Supplier schemas ──────────────────────────────────────────────────────
export const SupplierSchema = z.object({
  name: z.string().min(1).max(255),
  gstin: z.string().max(15).default(''),
  address: z.string().max(500).default(''),
  phone: z.string().max(20).default(''),
});

export type SupplierInput = z.infer<typeof SupplierSchema>;
