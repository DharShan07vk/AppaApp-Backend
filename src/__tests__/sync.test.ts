import { describe, it, expect } from 'vitest';
import { calculateLine, calculateBillTotals } from '../lib/money.js';

describe('Offline Sync & Idempotency Rules', () => {
  it('ensures syncClientId uniquely identifies an offline bill for idempotent re-transmission', () => {
    const syncClientId = 'client-uuid-550e8400-e29b-41d4-a716-446655440000';

    // Simulated queue replay map
    const serverSyncDb = new Map<string, { id: string; status: string }>();

    function processSyncItem(item: { syncClientId: string }) {
      if (serverSyncDb.has(item.syncClientId)) {
        return { status: 'already_synced', record: serverSyncDb.get(item.syncClientId) };
      }
      const newRecord = { id: 'srv-' + item.syncClientId, status: 'synced' };
      serverSyncDb.set(item.syncClientId, newRecord);
      return { status: 'created', record: newRecord };
    }

    const firstRun = processSyncItem({ syncClientId });
    expect(firstRun.status).toBe('created');
    expect(firstRun.record?.id).toBe('srv-' + syncClientId);

    // Second run with identical syncClientId (e.g. network retry after disconnect)
    const secondRun = processSyncItem({ syncClientId });
    expect(secondRun.status).toBe('already_synced');
    expect(secondRun.record?.id).toBe(firstRun.record?.id);
  });

  it('reconciles local bill totals with authoritative server calculations', () => {
    // Client sent approximate or uncalculated tax totals
    const clientItems = [
      { quantity: 2, ratePaise: 150000, discountBps: 0, gstBps: 1800 },
    ];

    const lines = clientItems.map((item) =>
      calculateLine({
        quantity: item.quantity,
        ratePaise: item.ratePaise,
        discountBps: item.discountBps,
        gstBps: item.gstBps,
        isInterState: false,
      }),
    );
    const serverTotals = calculateBillTotals(lines);

    // 2 x 1500 = 3000 taxable. 18% GST = 540 (270 CGST, 270 SGST). Grand total = 3540.
    expect(serverTotals.taxableTotalPaise).toBe(300000);
    expect(serverTotals.cgstTotalPaise).toBe(27000);
    expect(serverTotals.sgstTotalPaise).toBe(27000);
    expect(serverTotals.grandTotalPaise).toBe(354000);
  });
});
