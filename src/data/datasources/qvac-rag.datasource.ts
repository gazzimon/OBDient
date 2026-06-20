// QVAC RAG datasource — on-device retrieval over the OBD-II knowledge base.
//
// Uses the QVAC SDK's built-in RAG pipeline (embed -> vector store -> search),
// all running locally. A small embedding model (EmbeddingGemma 300M, 4-bit) is
// loaded separately from the chat LLM. The knowledge corpus is ingested once
// into a persistent on-device workspace; the workspace name carries the
// knowledge version, so bumping KNOWLEDGE_VERSION triggers a fresh re-index.
//
// Lifecycle:
//   1. initialize() — load the embedding model and ingest the corpus if needed.
//   2. search(query) — retrieve the most relevant knowledge snippets.
//   3. dispose() — free the embedding model from RAM (optional).

import {
  loadModel,
  unloadModel,
  ragIngest,
  ragSearch,
  ragListWorkspaces,
  EMBEDDINGGEMMA_300M_Q4_0,
} from '@qvac/sdk';
import { OBD_KNOWLEDGE, KNOWLEDGE_VERSION } from '@/data/knowledge/obd-knowledge';

// Workspace name is versioned: bumping KNOWLEDGE_VERSION re-ingests cleanly.
const WORKSPACE = `obd-knowledge-v${KNOWLEDGE_VERSION}`;

// Separate workspace for Claude-learned answers. Kept apart from the curated
// corpus so provenance stays clean: hits here are unverified (single-source).
const CLAUDE_WORKSPACE = 'claude-knowledge-v1';

export class QvacRagDataSource {
  private modelId: string | null = null;
  private initPromise: Promise<void> | null = null;
  private ingested = false;

  // Load the embedding model and ingest the corpus once (idempotent).
  async initialize(onProgress?: (progress: number) => void): Promise<void> {
    if (this.modelId !== null && this.ingested) return;
    if (this.initPromise !== null) return this.initPromise;

    this.initPromise = (async () => {
      if (this.modelId === null) {
        this.modelId = await loadModel({ modelSrc: EMBEDDINGGEMMA_300M_Q4_0 });
        onProgress?.(1);
      }

      // Ingest only if this versioned workspace doesn't already exist on disk.
      const workspaces = await ragListWorkspaces();
      const exists = workspaces.some((w) => w.name === WORKSPACE);
      if (!exists) {
        await ragIngest({
          modelId: this.modelId,
          documents: OBD_KNOWLEDGE.map((d) => d.content),
          workspace: WORKSPACE,
        });
      }
      this.ingested = true;
    })().catch((err) => {
      // Reset so a later call can retry from a clean state.
      this.initPromise = null;
      throw err;
    });

    return this.initPromise;
  }

  isReady(): boolean {
    return this.modelId !== null && this.ingested;
  }

  // Retrieve the top-K most relevant knowledge snippets for a query.
  // Returns [] on any failure so the assistant degrades gracefully.
  async search(query: string, topK = 4): Promise<string[]> {
    if (this.modelId === null || !this.ingested) return [];
    try {
      const results = await ragSearch({
        modelId: this.modelId,
        query,
        topK,
        workspace: WORKSPACE,
      });
      return results.map((r) => r.content);
    } catch {
      return [];
    }
  }

  // --- Claude-learned knowledge (separate, unverified workspace) -----------

  // Ingest a single Claude answer so it becomes semantically retrievable.
  // Best-effort: if the embedding model isn't loaded yet, silently skip — the
  // answer still lives in claudeKnowledge (MMKV) and stays keyword-searchable.
  async ingestClaude(text: string): Promise<void> {
    if (this.modelId === null || !text.trim()) return;
    try {
      await ragIngest({
        modelId: this.modelId,
        documents: [text],
        workspace: CLAUDE_WORKSPACE,
      });
    } catch {
      // ignore — keyword fallback covers this entry
    }
  }

  // Semantic search over Claude-learned answers. Returns content strings; the
  // caller maps them back to claudeKnowledge entries (which is also the source
  // of truth that filters out rejected/evicted answers).
  async searchClaude(query: string, topK = 2): Promise<string[]> {
    if (this.modelId === null) return [];
    try {
      const results = await ragSearch({
        modelId: this.modelId,
        query,
        topK,
        workspace: CLAUDE_WORKSPACE,
      });
      return results.map((r) => r.content);
    } catch {
      return [];
    }
  }

  async dispose(): Promise<void> {
    if (this.modelId === null) return;
    try {
      await unloadModel({ modelId: this.modelId });
    } finally {
      this.modelId = null;
      this.initPromise = null;
      this.ingested = false;
    }
  }
}

// Singleton — one embedding model + workspace for the whole app session.
export const qvacRag = new QvacRagDataSource();
