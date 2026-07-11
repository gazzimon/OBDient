// Distributed RAG layer via Hypercore + Hyperswarm.
//
// Each OBDient instance maintains a local Hypercore feed (append-only log) of
// anonymised diagnostic knowledge chunks. Instances discover each other through
// Hyperswarm using a shared topic derived from the app name, and replicate feeds
// in read-only mode from peers.
//
// Privacy contract:
//   - Chunks NEVER include VIN, device address, or any user identifier.
//   - Only DTCs, make, year range, and anonymised content are shared.
//   - Contributing is opt-in (double toggle in Settings).
//
// Lifecycle:
//   1. initialize() — open or create local feed, join swarm if enabled.
//   2. getChunks(dtc?) — query in-memory chunks from all replicated feeds.
//   3. contribute(chunk) — append an anonymous chunk to the local feed.
//   4. peerCount() — how many peers are currently connected.
//   5. dispose() — leave swarm and close all feeds.
//
// NOTE: Hypercore v11 is fully async/await — no callback-based ready(),
// append(), get(), update(), or close(). All methods return Promises.

import Hypercore from 'hypercore';
import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import * as FileSystem from 'expo-file-system';
import { shimiTree } from '@/data/knowledge/shimi-tree';
import type { DistributedChunk, FactChunk, PatternChunk } from '@/data/knowledge/distributed-chunk';
import { isFactChunk, isPatternChunk, isSkosPatch, QUORUM } from '@/data/knowledge/distributed-chunk';
import { upsertById } from '@/core/utils/collections';
import { trustRegistry } from './trust-registry';
import { RemoteFeedManager } from './remote-feed-manager';

// Re-export FactChunk as KnowledgeChunk for backwards compatibility with
// knowledge-extractor.ts and sessionStore.ts.
export type KnowledgeChunk = FactChunk;
export { QUORUM as MIN_CONFIRMATIONS_MAP };
export const MIN_CONFIRMATIONS = QUORUM.fact;

// Stable swarm topic — all OBDient instances rendezvous here.
const SWARM_TOPIC = b4a.from(
  'obdient-rag-v1'.padEnd(32, '\0').slice(0, 32),
  'utf8',
);

// Cap on concurrently-open remote feeds. Beyond it, new peers are served local
// replication only — bounds RAM / file descriptors / disk under peer churn (P0).
const MAX_REMOTE_FEEDS = 32;

// Reject remote blocks larger than this before JSON.parse — a hostile peer must
// not be able to force a giant string allocation on ingest (P1 hardening).
const MAX_CHUNK_BYTES = 64 * 1024;

export class HypercoreKnowledgeSource {
  private swarm: InstanceType<typeof Hyperswarm> | null = null;
  private localFeed: InstanceType<typeof Hypercore> | null = null;
  private chunks: FactChunk[] = [];
  private patterns: PatternChunk[] = [];
  private _ready = false;

  // One feed per peer, reused across reconnects and closed on disconnect, with
  // a hard cap on concurrency. Replaces the old grow-only arrays that leaked a
  // fresh feed + temp dir on every 'connection' event (P0).
  private readonly remoteFeeds = new RemoteFeedManager<InstanceType<typeof Hypercore>>(
    MAX_REMOTE_FEEDS,
    (p) => {
      void FileSystem.deleteAsync(p, { idempotent: true }).catch(() => {
        // Best-effort cleanup — ignore errors.
      });
    },
  );

  async initialize(opts: { enabled: boolean; storagePath?: string }): Promise<void> {
    if (!opts.enabled) return;
    if (this._ready) return;

    const dir =
      opts.storagePath ??
      `${FileSystem.documentDirectory ?? ''}hypercore-knowledge`;

    // Open (or create) the local writer feed.
    this.localFeed = new Hypercore(`${dir}/local`);
    await this.localFeed.ready();

    // Load existing local chunks into memory.
    await this._loadFeed(this.localFeed);

    // Join the swarm for peer discovery and replication.
    this.swarm = new Hyperswarm();
    this.swarm.join(SWARM_TOPIC, { server: true, client: true });

    this.swarm.on('connection', (socket: NodeJS.ReadWriteStream) => {
      void this._onPeer(socket);
    });

    this._ready = true;
  }

  isReady(): boolean {
    return this._ready;
  }

  peerCount(): number {
    return this.swarm?.connections?.size ?? 0;
  }

  // Return chunks relevant to a DTC (or all chunks if no DTC given).
  // Only returns chunks that meet the minimum confirmation threshold.
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
    if (this.localFeed == null) return;
    const buf = b4a.from(JSON.stringify(chunk), 'utf8');
    await this.localFeed.append(buf);
    // Add to in-memory cache immediately (upsert: never duplicate on re-append).
    upsertById(this.chunks, chunk);
  }

  async dispose(): Promise<void> {
    await this.swarm?.destroy();
    if (this.localFeed) await this.localFeed.close();
    // Closes every remote feed and removes its temp directory.
    await this.remoteFeeds.closeAll();
    this.swarm = null;
    this.localFeed = null;
    this.chunks = [];
    this.patterns = [];
    this._ready = false;
  }

  // --- Private ---

  private async _onPeer(socket: NodeJS.ReadWriteStream & { remotePublicKey?: Buffer }): Promise<void> {
    // Derive a stable peerId from the remote public key (no raw key stored).
    const peerId = socket.remotePublicKey
      ? b4a.toString(socket.remotePublicKey, 'hex').slice(0, 16)
      : `unknown-${Date.now()}`;

    trustRegistry.recordPublication(peerId);

    // Replicate our local feed on THIS socket (a fresh stream per connection).
    if (this.localFeed) {
      const stream = this.localFeed.replicate(true);
      stream.pipe(socket as any).pipe(stream);
    }

    // Reuse this peer's remote feed if one is already open (another live socket
    // / a prior reconnect); otherwise open one under a STABLE per-peer path.
    // Returns null when the concurrent-feed cap is hit — then we serve local
    // replication only and skip the remote feed entirely.
    const cacheDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
    const acquired = this.remoteFeeds.acquire(peerId, () => {
      const path = `${cacheDir}hc-remote-${peerId}`;
      return { feed: new Hypercore(path), path };
    });
    if (acquired == null) return;

    // Drop this peer's ref when the socket closes; the feed is closed and its
    // temp dir removed once the last socket for the peer goes away.
    socket.on('close', () => {
      void this.remoteFeeds.release(peerId);
    });

    // Load existing blocks only for a newly-opened feed — a reused feed is
    // already in memory, and upsert-by-id makes a re-load harmless anyway.
    if (acquired.isNew) {
      await acquired.feed.ready();
      void this._loadFeed(acquired.feed, peerId);
    }

    const remoteStream = acquired.feed.replicate(false);
    remoteStream.pipe(socket as any).pipe(remoteStream);
  }

  private _dispatch(chunk: DistributedChunk, peerId: string): void {
    // Gate: silenced peers contribute nothing
    if (!trustRegistry.isTrusted(peerId)) return;

    if (isFactChunk(chunk) && chunk.content) {
      // Weight confidence by peer reputation before storing
      const weighted: FactChunk = {
        ...chunk,
        confidence: trustRegistry.weightedConfidence(chunk.confidence, peerId),
      };
      // Upsert by id: a peer re-sending a fact (reconnect, feed re-load) must
      // refresh it in place, never pile up duplicates that skew getChunks (P1).
      upsertById(this.chunks, weighted);
      shimiTree.applyChunk(weighted);
      // Record confirmation signal when a chunk reaches quorum
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
      // Only high-trust peers can influence ontology patches
      if (trustRegistry.scoreFor(peerId) >= 0.7) {
        shimiTree.applySkosPatch(chunk);
      }
    }
  }

  private async _loadFeed(feed: InstanceType<typeof Hypercore>, peerId = 'local'): Promise<void> {
    await feed.update({ ifAvailable: true });
    const length: number = feed.length;

    for (let i = 0; i < length; i++) {
      try {
        const buf: Buffer = await feed.get(i);
        // Reject oversized blocks before parsing: an untrusted peer must not be
        // able to force a giant string allocation on ingest (P1 hardening).
        if (buf == null || buf.length > MAX_CHUNK_BYTES) continue;
        const chunk: DistributedChunk = JSON.parse(b4a.toString(buf, 'utf8'));
        this._dispatch(chunk, peerId);
      } catch {
        // Skip malformed chunks.
      }
    }
  }
}

// Singleton.
export const hypercoreKnowledge = new HypercoreKnowledgeSource();
