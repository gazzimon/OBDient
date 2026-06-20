// Persists Claude's general answers on-device so CARpsy can use them offline.
// Storage: MMKV (fast, synchronous, no SQLite overhead for a key-value store).
// SHIMI integration added in Step 3.

import { createMMKV } from 'react-native-mmkv';
import { qvacRag } from './qvac-rag.datasource';

const mmkv = createMMKV({ id: 'claude-knowledge' });
const ENTRIES_KEY = 'entries';
const MAX_ENTRIES = 500;

export interface ClaudeKnowledgeEntry {
  readonly query: string;
  readonly answer: string;
  readonly storedAt: string; // ISO-8601
  // Human confirmations (👍). 0 = unverified single-source Claude output.
  // Once confirmed, this entry is no longer a pure single-source suggestion.
  readonly confirmations: number;
}

export class ClaudeKnowledgeDataSource {
  private entries: ClaudeKnowledgeEntry[] = [];

  constructor() {
    this.load();
  }

  async store(query: string, answer: string): Promise<void> {
    this.entries.unshift({ query, answer, storedAt: new Date().toISOString(), confirmations: 0 });
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(0, MAX_ENTRIES);
    this.persist();
    // Make the answer semantically retrievable (best-effort; keyword still works).
    await qvacRag.ingestClaude(answer);
  }

  /** Human feedback 👍 — mark a Claude-origin entry as confirmed.
   *  A confirmed entry is no longer a pure single-source suggestion. */
  confirm(query: string): void {
    const entry = this.entries.find((e) => e.query === query);
    if (!entry) return;
    const idx = this.entries.indexOf(entry);
    this.entries[idx] = { ...entry, confirmations: entry.confirmations + 1 };
    this.persist();
  }

  /** Human feedback 👎 — remove a rejected Claude-origin entry so it stops
   *  surfacing as knowledge. Rejecting a hallucination deletes it from Layer 0. */
  reject(query: string): void {
    this.entries = this.entries.filter((e) => e.query !== query);
    this.persist();
  }

  private persist(): void {
    mmkv.set(ENTRIES_KEY, JSON.stringify(this.entries));
  }

  // Keyword-based search — no embeddings required.
  // Returns the answer texts of the best-matching stored entries.
  search(query: string, topK = 3): string[] {
    return this.searchEntries(query, topK).map((e) => e.answer);
  }

  // Semantic search via embeddings, mapped back to entries so HITL targeting
  // (the `query` key) is preserved. Falls back to keyword search when the
  // embedding model isn't ready or returns nothing.
  //
  // MMKV is the source of truth: an answer that was rejected/evicted has no
  // backing entry, so it's filtered out here even if it lingers in the RAG index.
  async searchEntriesSemantic(query: string, topK = 3): Promise<ClaudeKnowledgeEntry[]> {
    const hits = await qvacRag.searchClaude(query, topK);
    if (hits.length === 0) return this.searchEntries(query, topK);

    const seen = new Set<string>();
    const entries: ClaudeKnowledgeEntry[] = [];
    for (const content of hits) {
      const entry = this.entries.find((e) => e.answer === content);
      if (entry && !seen.has(entry.query)) {
        seen.add(entry.query);
        entries.push(entry);
      }
    }
    return entries.length > 0 ? entries : this.searchEntries(query, topK);
  }

  // Same as search() but returns full entries, so the caller can target a
  // specific entry for human feedback (confirm/reject) by its `query` key.
  searchEntries(query: string, topK = 3): ClaudeKnowledgeEntry[] {
    const words = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3);

    if (words.length === 0) return [];

    return this.entries
      .map((e) => {
        const text = `${e.query} ${e.answer}`.toLowerCase();
        const score = words.filter((w) => text.includes(w)).length;
        return { entry: e, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((s) => s.entry);
  }

  getAll(): ClaudeKnowledgeEntry[] {
    return this.entries;
  }

  count(): number {
    return this.entries.length;
  }

  private load(): void {
    try {
      const raw = mmkv.getString(ENTRIES_KEY);
      const parsed = raw ? (JSON.parse(raw) as Partial<ClaudeKnowledgeEntry>[]) : [];
      // Normalize entries stored before `confirmations` existed.
      this.entries = parsed.map((e) => ({
        query: e.query ?? '',
        answer: e.answer ?? '',
        storedAt: e.storedAt ?? new Date().toISOString(),
        confirmations: e.confirmations ?? 0,
      }));
    } catch {
      this.entries = [];
    }
  }
}

export const claudeKnowledge = new ClaudeKnowledgeDataSource();
