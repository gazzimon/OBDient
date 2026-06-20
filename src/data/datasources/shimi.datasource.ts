// SHIMI datasource — hierarchical retrieval layer that sits in front of QVAC RAG.
//
// Search pipeline (4 layers):
//   0. claudeKnowledge.search() → answers Claude already learned for similar queries
//      (persisted on-device, no internet needed at search time)
//   1. shimiTree.search(dtcId) → content strings ranked by node confidence
//      (hierarchical: canonical concept + ancestors + SKOS related)
//   2. qvacRag.search(expandedQuery) → vector similarity over the same corpus
//   3. Merge: Claude knowledge first (most precise), then SHIMI, then RAG
//
// Layers degrade gracefully — any failure returns [].

import { shimiTree } from '@/data/knowledge/shimi-tree';
import { qvacRag } from './qvac-rag.datasource';
import { claudeKnowledge } from './claude-knowledge.datasource';

export class ShimiDataSource {
  /** Retrieve top-K snippets for a given DTC code and free-text query.
   *  Returns [] on any failure so the caller always degrades gracefully. */
  async search(dtcId: string | undefined, query: string, topK = 6): Promise<string[]> {
    try {
      // Layer 0: Claude-learned knowledge (keyword match, highest relevance priority)
      const claudeResults = claudeKnowledge.search(query, 2);

      // Layer 1: SHIMI hierarchical retrieval (confidence-ranked, synchronous)
      const shimiResults = dtcId ? shimiTree.search(dtcId, topK) : [];

      // Layer 2: QVAC RAG vector similarity (async, may return [])
      const ragResults = await qvacRag.search(query, topK);

      // Merge: Claude knowledge first, then SHIMI, then RAG — deduplicate
      const seen = new Set<string>();
      const merged: string[] = [];
      for (const r of [...claudeResults, ...shimiResults, ...ragResults]) {
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
