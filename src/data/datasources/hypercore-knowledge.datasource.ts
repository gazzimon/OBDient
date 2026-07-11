// Distributed RAG layer via Hypercore + Hyperswarm — RN side (PLAN-002 v2 C2).
//
// The feed, the swarm and the real replication now live in the Bare worklet
// (p2p/p2p-worklet.mjs, ns:'knowledge'); Hermes has no Node built-ins, so this
// file no longer imports hypercore/hyperswarm (the Metro stub is retired). It
// is an IPC client that keeps an in-memory MIRROR of the knowledge the worklet
// ingests, so the hot-path reads stay synchronous:
//
//   - getChunks(dtc?) / getPatterns()  → sync, read the mirror (llm.repository
//     calls these mid-prompt-assembly; an IPC round-trip per read is a non-
//     starter).
//   - the worklet pushes every ingested block up as a `chunk` event; _dispatch
//     applies trust weighting (trustRegistry) + SHIMI + quorum HERE, where the
//     MMKV-backed singletons live. That split is deliberate: transport in Bare,
//     knowledge semantics in Hermes.
//
// Privacy contract (unchanged): chunks NEVER include VIN, device address, or any
// user identifier — only DTCs, make, year range, anonymised content. Contributing
// is opt-in (double toggle in Settings).
//
// Continuous ingest (ADR-0010 F1) is the worklet's job: it registers an `append`
// listener per remote feed, so blocks that arrive by live replication after a
// connection opens are ingested and pushed up in the same session.

import { shimiTree } from '@/data/knowledge/shimi-tree';
import type { DistributedChunk, FactChunk, PatternChunk } from '@/data/knowledge/distributed-chunk';
import { isFactChunk, isPatternChunk, isSkosPatch, QUORUM } from '@/data/knowledge/distributed-chunk';
import { upsertById } from '@/core/utils/collections';
import { trustRegistry } from './trust-registry';
import { workletHost } from './worklet-host';

// Re-export FactChunk as KnowledgeChunk for backwards compatibility with
// knowledge-extractor.ts and sessionStore.ts.
export type KnowledgeChunk = FactChunk;
export { QUORUM as MIN_CONFIRMATIONS_MAP };
export const MIN_CONFIRMATIONS = QUORUM.fact;

export class HypercoreKnowledgeSource {
  private chunks: FactChunk[] = [];
  private patterns: PatternChunk[] = [];
  private _ready = false;
  private _peers = 0;
  private _subscribed = false;

  // storagePath is accepted for API compatibility but ignored — the worklet
  // owns storage (bare-os homedir). The RN side never touched the disk anyway.
  async initialize(opts: { enabled: boolean; storagePath?: string }): Promise<void> {
    if (!opts.enabled) return;
    if (this._ready) return;

    // Register the ingest/churn listeners BEFORE opening, so the initial local-
    // feed replay (pushed during the open handler) is not missed.
    this._subscribe();

    const r = await workletHost.request('knowledge', 'open', { swarm: true }, 'open');
    if (!r.ok) throw new Error((r.err as string) ?? 'knowledge open failed');
    console.log(`[Knowledge] feed ${String(r.key).slice(0, 16)}… (${r.length} blocks)`);
    this._ready = true;
  }

  isReady(): boolean {
    return this._ready;
  }

  peerCount(): number {
    return this._peers;
  }

  // Return chunks relevant to a DTC (or all chunks if no DTC given). Only
  // returns chunks that meet the minimum confirmation threshold.
  getChunks(dtc?: string): KnowledgeChunk[] {
    return this.chunks.filter(
      (c) =>
        c.confirmations >= MIN_CONFIRMATIONS &&
        (dtc == null || c.dtc == null || c.dtc === dtc),
    );
  }

  // Return Layer 2 patterns that have reached quorum.
  getPatterns(): PatternChunk[] {
    return this.patterns.filter((p) => p.confirmations >= QUORUM.pattern);
  }

  // Append an anonymous knowledge chunk to the local feed (opt-in only).
  async contribute(chunk: FactChunk): Promise<void> {
    const r = await workletHost.request('knowledge', 'contribute', { chunk }, 'append');
    if (!r.ok) throw new Error((r.err as string) ?? 'knowledge contribute failed');
    // Mirror our own fact immediately (upsert: never duplicate on re-append).
    // No trust weighting for locally-authored facts — same as before C2; they
    // stay below quorum until peers confirm, so getChunks won't surface them yet.
    upsertById(this.chunks, chunk);
  }

  async dispose(): Promise<void> {
    if (this._ready) {
      await workletHost.request('knowledge', 'close', {}, 'close').catch(() => {
        // Best-effort — the shared worklet keeps running for harvest.
      });
    }
    this.chunks = [];
    this.patterns = [];
    this._peers = 0;
    this._ready = false;
  }

  // --- Private ---

  private _subscribe(): void {
    if (this._subscribed) return;
    this._subscribed = true;

    // Every block the worklet ingests (local replay + live remote replication).
    workletHost.on('knowledge', 'chunk', (r) => {
      const chunk = r.chunk as DistributedChunk | undefined;
      const peerId = (r.peerId as string) ?? 'unknown';
      if (chunk != null) this._dispatch(chunk, peerId);
    });

    // Peer churn: keep peerCount() fresh and record publications for trust stats.
    workletHost.on('knowledge', 'peer', (r) => {
      if (typeof r.peers === 'number') this._peers = r.peers;
      if (typeof r.peerId === 'string') trustRegistry.recordPublication(r.peerId);
    });
  }

  // Apply an ingested chunk to the mirror — trust gate + weighting + SHIMI +
  // quorum. Unchanged from the pre-C2 datasource; only the source changed
  // (worklet IPC events instead of a local hypercore feed read).
  private _dispatch(chunk: DistributedChunk, peerId: string): void {
    // Gate: silenced peers contribute nothing.
    if (!trustRegistry.isTrusted(peerId)) return;

    if (isFactChunk(chunk) && chunk.content) {
      // Weight confidence by peer reputation before storing.
      const weighted: FactChunk = {
        ...chunk,
        confidence: trustRegistry.weightedConfidence(chunk.confidence, peerId),
      };
      // Upsert by id: a peer re-sending a fact (reconnect, feed re-load) must
      // refresh it in place, never pile up duplicates that skew getChunks (P1).
      upsertById(this.chunks, weighted);
      shimiTree.applyChunk(weighted);
      // Record confirmation signal when a chunk reaches quorum.
      if (weighted.confirmations >= QUORUM.fact) {
        trustRegistry.recordConfirmation(peerId);
      }
    } else if (isPatternChunk(chunk)) {
      const weighted: PatternChunk = {
        ...chunk,
        confidence: trustRegistry.weightedConfidence(chunk.confidence, peerId),
      };
      upsertById(this.patterns, weighted);
      if (weighted.confirmations >= QUORUM.pattern) {
        trustRegistry.recordConfirmation(peerId);
      }
    } else if (isSkosPatch(chunk)) {
      // Only high-trust peers can influence ontology patches.
      if (trustRegistry.scoreFor(peerId) >= 0.7) {
        shimiTree.applySkosPatch(chunk);
      }
    }
  }
}

// Singleton.
export const hypercoreKnowledge = new HypercoreKnowledgeSource();
