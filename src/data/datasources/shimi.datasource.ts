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

/** A Claude-origin snippet retained with its query key so human feedback
 *  (confirm/reject) can target the exact stored entry. */
export interface UnverifiedHit {
  readonly content: string;
  readonly query: string;
}

/** Retrieval result split by provenance.
 *  - verified:   curated corpus (SHIMI tree + RAG over obd-knowledge) — trusted.
 *  - unverified: Claude-origin answers — single-source, not yet human-confirmed. */
export interface ProvenanceResult {
  readonly verified: string[];
  readonly unverified: UnverifiedHit[];
}

export class ShimiDataSource {
  /** Retrieve top-K snippets for a given DTC code and free-text query.
   *  Returns [] on any failure so the caller always degrades gracefully.
   *  NOTE: flat merge — used by interpret(). Chat uses searchWithProvenance(). */
  async search(dtcId: string | undefined, query: string, topK = 6): Promise<string[]> {
    try {
      const claudeResults = claudeKnowledge.search(query, 2);
      const shimiResults = dtcId ? shimiTree.search(dtcId, topK) : [];
      const ragResults = await qvacRag.search(query, topK);

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

  /** Provenance-aware retrieval for the chat flow.
   *  Keeps curated knowledge (trusted) separate from Claude-origin suggestions
   *  (unverified) so the prompt can present them with different authority and
   *  so human feedback can target the right source. */
  async searchWithProvenance(
    dtcId: string | undefined,
    query: string,
    topK = 4,
  ): Promise<ProvenanceResult> {
    try {
      // Unverified: Claude-origin answers (kept with their query key for HITL).
      const unverified = claudeKnowledge.searchEntries(query, 2).map((e) => ({
        content: e.answer,
        query: e.query,
      }));

      // Verified: curated SHIMI hierarchy + RAG over the curated corpus.
      const shimiResults = dtcId ? shimiTree.search(dtcId, topK) : [];
      const ragResults = await qvacRag.search(query, topK);

      const seen = new Set<string>();
      const verified: string[] = [];
      for (const r of [...shimiResults, ...ragResults]) {
        if (!seen.has(r)) {
          seen.add(r);
          verified.push(r);
        }
      }

      return { verified: verified.slice(0, topK), unverified };
    } catch {
      return { verified: [], unverified: [] };
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
