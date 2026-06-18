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

import Hypercore from 'hypercore';
import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import * as FileSystem from 'expo-file-system';
import { shimiTree } from '@/data/knowledge/shimi-tree';

export interface KnowledgeChunk {
  id: string;
  dtc?: string;
  make?: string;
  yearRange?: [number, number];
  content: string;
  confidence: number;
  confirmations: number;
  createdAt: string;
}

// Minimum peer confirmations before a remote chunk is used in RAG context.
export const MIN_CONFIRMATIONS = 3;

// Stable swarm topic — all OBDient instances rendezvous here.
const SWARM_TOPIC = b4a.from(
  'obdient-rag-v1'.padEnd(32, '\0').slice(0, 32),
  'utf8',
);

export class HypercoreKnowledgeSource {
  private swarm: InstanceType<typeof Hyperswarm> | null = null;
  private localFeed: InstanceType<typeof Hypercore> | null = null;
  private remoteFeeds: InstanceType<typeof Hypercore>[] = [];
  private chunks: KnowledgeChunk[] = [];
  private ready = false;

  async initialize(opts: { enabled: boolean; storagePath?: string }): Promise<void> {
    if (!opts.enabled) return;
    if (this.ready) return;

    const dir =
      opts.storagePath ??
      `${FileSystem.documentDirectory ?? ''}hypercore-knowledge`;

    // Open (or create) the local writer feed.
    this.localFeed = new Hypercore(`${dir}/local`);
    await new Promise<void>((resolve, reject) =>
      this.localFeed!.ready((err: Error | null) => (err ? reject(err) : resolve())),
    );

    // Load existing local chunks into memory.
    await this._loadFeed(this.localFeed);

    // Join the swarm for peer discovery and replication.
    this.swarm = new Hyperswarm();
    this.swarm.join(SWARM_TOPIC, { server: true, client: true });

    this.swarm.on('connection', (socket: NodeJS.ReadWriteStream) => {
      this._onPeer(socket);
    });

    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
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

  // Append an anonymous knowledge chunk to the local feed (opt-in only).
  async contribute(chunk: KnowledgeChunk): Promise<void> {
    if (this.localFeed == null) return;
    const buf = b4a.from(JSON.stringify(chunk), 'utf8');
    await new Promise<void>((resolve, reject) =>
      this.localFeed!.append(buf, (err: Error | null) =>
        err ? reject(err) : resolve(),
      ),
    );
    // Add to in-memory cache immediately.
    this.chunks.push(chunk);
  }

  async dispose(): Promise<void> {
    await this.swarm?.destroy();
    await new Promise<void>((r) => this.localFeed?.close(r));
    for (const feed of this.remoteFeeds) {
      await new Promise<void>((r) => feed.close(r));
    }
    this.swarm = null;
    this.localFeed = null;
    this.remoteFeeds = [];
    this.chunks = [];
    this.ready = false;
  }

  // --- Private ---

  private _onPeer(socket: NodeJS.ReadWriteStream): void {
    // Replicate local feed to/from peer.
    if (this.localFeed) {
      const stream = this.localFeed.replicate(true);
      stream.pipe(socket as any).pipe(stream);
    }

    // Open a read-only remote feed identified by the peer's public key.
    // We do this lazily: the key is exchanged via the replication handshake.
    const remoteFeed = new Hypercore(
      (name: string) => {
        // In-memory storage for remote feeds (no disk persistence).
        const chunks: Record<string, Buffer> = {};
        return {
          read: (key: string, cb: (err: Error | null, buf?: Buffer) => void) =>
            cb(null, chunks[key]),
          write: (
            key: string,
            value: Buffer,
            cb: (err: Error | null) => void,
          ) => {
            chunks[key] = value;
            cb(null);
          },
          del: (key: string, cb: (err: Error | null) => void) => {
            delete chunks[key];
            cb(null);
          },
          list: (cb: (err: Error | null, list?: string[]) => void) =>
            cb(null, Object.keys(chunks)),
        };
      },
    );

    remoteFeed.ready((err: Error | null) => {
      if (err) return;
      this.remoteFeeds.push(remoteFeed);
      this._loadFeed(remoteFeed);

      const remoteStream = remoteFeed.replicate(false);
      remoteStream.pipe(socket as any).pipe(remoteStream);
    });
  }

  private async _loadFeed(feed: InstanceType<typeof Hypercore>): Promise<void> {
    const length: number = await new Promise((resolve, reject) =>
      feed.update({ ifAvailable: true }, (err: Error | null) => {
        if (err) return resolve(0);
        resolve(feed.length);
      }),
    );

    for (let i = 0; i < length; i++) {
      try {
        const buf: Buffer = await new Promise((resolve, reject) =>
          feed.get(i, (err: Error | null, data: Buffer) =>
            err ? reject(err) : resolve(data),
          ),
        );
        const chunk: KnowledgeChunk = JSON.parse(b4a.toString(buf, 'utf8'));
        if (chunk && chunk.content) {
          this.chunks.push(chunk);
          // Update SHIMI confidence weight for the matching concept node
          shimiTree.applyChunk(chunk);
        }
      } catch {
        // Skip malformed chunks.
      }
    }
  }
}

// Singleton.
export const hypercoreKnowledge = new HypercoreKnowledgeSource();
