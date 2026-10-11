import { describe, it, expect } from 'vitest';
import {
  normalizePartString,
  normalizePartKey,
  matchBillItemToPart,
} from '../lib/part-matching.js';

describe('Part Matching & Normalization', () => {
  it('normalizes part numbers and names by collapsing punctuation, spaces, and unifying separators', () => {
    expect(normalizePartString('  21100/04000  ')).toBe('21100-04000');
    expect(normalizePartString('CHE/25-2773989')).toBe('CHE-25-2773989');
    expect(normalizePartKey('21100-04000')).toBe('2110004000');
    expect(normalizePartKey('21100/04000')).toBe('2110004000');
    expect(normalizePartKey('  TATA   ACE   KIT  ')).toBe('TATAACEKIT');
  });

  it('matches by exact part number across different separator styles', () => {
    const existingParts = [
      { id: 'part-1', name: 'Engine Kit', partNumber: '21100-04000', hsn: '8708' },
    ];

    // Incoming with slash instead of dash
    const result = matchBillItemToPart(
      { name: 'XCENT 1.2L KIT', partNumber: '21100/04000', hsn: '8708' },
      existingParts,
    );

    expect(result.confidence).toBe('EXACT_PART_NUMBER');
    expect(result.matchedId).toBe('part-1');
    expect(result.isAutoMerge).toBe(true);
  });

  it('matches by same HSN plus normalized name when part number is missing', () => {
    const existingParts = [
      { id: 'part-2', name: 'BRAKE PAD SET', partNumber: '', hsn: '8708' },
    ];

    const result = matchBillItemToPart(
      { name: 'Brake Pad Set', partNumber: '', hsn: '8708' },
      existingParts,
    );

    expect(result.confidence).toBe('HSN_AND_NAME');
    expect(result.matchedId).toBe('part-2');
    expect(result.isAutoMerge).toBe(true);
  });

  it('flags fuzzy matches as suggestions and NEVER auto-merges', () => {
    const existingParts = [
      { id: 'part-3', name: 'TATA ACE CLUTCH KIT', partNumber: 'TC-101', hsn: '8708' },
    ];

    // Substring match without same part number
    const result = matchBillItemToPart(
      { name: 'TATA ACE CLUTCH', partNumber: 'DIFF-999', hsn: '8708' },
      existingParts,
    );

    expect(result.confidence).toBe('SUGGESTION');
    expect(result.isAutoMerge).toBe(false); // MUST NEVER auto-merge fuzzy matches
  });
});
