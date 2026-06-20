// Persists Claude's general answers on-device so CARpsy can use them offline.
// Storage: MMKV (fast, synchronous, no SQLite overhead for a key-value store).
// SHIMI integration added in Step 3.

import { createMMKV } from 'react-native-mmkv';

const mmkv = createMMKV({ id: 'claude-knowledge' });
const ENTRIES_KEY = 'entries';
const MAX_ENTRIES = 500;

export interface ClaudeKnowledgeEntry {
  readonly query: string;
  readonly answer: string;
  readonly storedAt: string; // ISO-8601
}

export class ClaudeKnowledgeDataSource {
  private entries: ClaudeKnowledgeEntry[] = [];

  constructor() {
    this.load();
  }

  async store(query: string, answer: string): Promise<void> {
    this.entries.unshift({ query, answer, storedAt: new Date().toISOString() });
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(0, MAX_ENTRIES);
    mmkv.set(ENTRIES_KEY, JSON.stringify(this.entries));
  }

  // Keyword-based search — no embeddings required.
  // Returns the answer texts of the best-matching stored entries.
  search(query: string, topK = 3): string[] {
    return this.searchEntries(query, topK).map((e) => e.answer);
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
      this.entries = raw ? (JSON.parse(raw) as ClaudeKnowledgeEntry[]) : [];
    } catch {
      this.entries = [];
    }
  }
}

export const claudeKnowledge = new ClaudeKnowledgeDataSource();
