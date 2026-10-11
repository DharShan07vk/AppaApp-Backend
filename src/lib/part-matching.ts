/**
 * Part normalization and matching rules from part-matching skill.
 */

export function normalizePartString(str: string): string {
  if (!str) return '';
  return str
    .toUpperCase()
    .trim()
    .replace(/[\/\-_.]+/g, '-') // unify / and - to -
    .replace(/\s+/g, ' ');      // collapse multiple spaces to single space
}

export function normalizePartKey(str: string): string {
  if (!str) return '';
  return str
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ''); // strip all punctuation and whitespace
}

export type MatchConfidence = 'EXACT_PART_NUMBER' | 'HSN_AND_NAME' | 'EXACT_NAME' | 'SUGGESTION' | 'NONE';

export interface PartMatchResult {
  confidence: MatchConfidence;
  matchedId?: string;
  isAutoMerge: boolean;
}

export function matchBillItemToPart(
  item: { name: string; partNumber?: string; hsn?: string },
  candidateParts: Array<{ id: string; name: string; partNumber?: string; hsn?: string }>,
): PartMatchResult {
  const normItemNum = normalizePartKey(item.partNumber ?? '');
  const normItemName = normalizePartKey(item.name);
  const normItemHsn = (item.hsn ?? '').trim();

  // 1. Exact part number (normalized)
  if (normItemNum) {
    const match = candidateParts.find((p) => normalizePartKey(p.partNumber ?? '') === normItemNum);
    if (match) {
      return { confidence: 'EXACT_PART_NUMBER', matchedId: match.id, isAutoMerge: true };
    }
  }

  // 2. Same HSN plus normalized name
  if (normItemHsn && normItemName) {
    const match = candidateParts.find(
      (p) => (p.hsn ?? '').trim() === normItemHsn && normalizePartKey(p.name) === normItemName,
    );
    if (match) {
      return { confidence: 'HSN_AND_NAME', matchedId: match.id, isAutoMerge: true };
    }
  }

  // 3. Normalized name alone (exact)
  if (normItemName) {
    const match = candidateParts.find((p) => normalizePartKey(p.name) === normItemName);
    if (match) {
      return { confidence: 'EXACT_NAME', matchedId: match.id, isAutoMerge: true };
    }
  }

  // 4. Fuzzy check — similar but not exact -> SUGGESTION (NEVER auto-merge!)
  for (const p of candidateParts) {
    const pName = normalizePartKey(p.name);
    if (pName.includes(normItemName) || normItemName.includes(pName)) {
      return { confidence: 'SUGGESTION', matchedId: p.id, isAutoMerge: false };
    }
  }

  return { confidence: 'NONE', isAutoMerge: false };
}
