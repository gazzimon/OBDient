// SHIMI datasource — hierarchical retrieval layer that sits in front of QVAC RAG.
//
// Search pipeline:
//   1. shimiTree.search(dtcId) → content strings ranked by node confidence
//      (hierarchical: canonical concept + ancestors + SKOS related)
//   2. qvacRag.search(expandedQuery) → vector similarity over the same corpus
//      (catches docs whose concept mapping might not cover the exact query phrasing)
//   3. Merge: SHIMI results first (confidence-ranked), then any RAG results not
//      already included, up to topK total.
//
// This hybrid approach means:
//   - High-confirmation nodes (learned from Hypercore peers) surface first.
//   - Embedding similarity still catches edge cases.
//   - Neither layer blocks the other — both degrade gracefully to [].

import { shimiTree } from '@/data/knowledge/shimi-tree';
import { qvacRag } from './qvac-rag.datasource';

export class ShimiDataSource {
  /** Retrieve top-K snippets for a given DTC code and free-text query.
   *  Returns [] on any failure so the caller always degrades gracefully. */
  async search(dtcId: string | undefined, query: string, topK = 6): Promise<string[]> {
    try {
      // Layer 1: SHIMI hierarchical retrieval (confidence-ranked, synchronous)
      const shimiResults = dtcId ? shimiTree.search(dtcId, topK) : [];

      // Layer 2: QVAC RAG vector similarity (async, may return [])
      const ragResults = await qvacRag.search(query, topK);

      // Merge: SHIMI first, then RAG results not already present
      const seen = new Set(shimiResults);
      const merged = [...shimiResults];
      for (const r of ragResults) {
        if (!seen.has(r)) {
          seen.add(r);
          merged.push(r);
        }
      }

      return merged.slice(0, topK);
    } catch {
      return [];
    }
  }

  /** Expose confidence for a concept — used by the Settings debug panel. */
  confidenceFor(conceptId: string): number {
    return shimiTree.confidenceFor(conceptId);
  }

  /** Top nodes by confidence — for diagnostics UI. */
  topNodes(limit = 10) {
    return shimiTree.topNodes(limit);
  }
}

// Singleton.
export const shimiDataSource = new ShimiDataSource();
