// Remote feed lifecycle manager for the distributed knowledge network.
//
// Hyperswarm fires a 'connection' event for every socket to a peer, and peer
// churn is normal (the seed reconnects constantly). The naive handler opened a
// brand-new Hypercore in a fresh temp directory on EVERY connection and never
// closed it — so reconnecting peers leaked feeds, file descriptors and disk
// without bound over a long session.
//
// This manager fixes that with three invariants:
//   1. ONE feed per peerId, reused across reconnects (ref-counted per socket).
//   2. The feed is closed and its temp dir removed when the LAST socket drops.
//   3. A hard cap on concurrently-open feeds — beyond it, new peers get local
//      replication only, so a flood of peers can't exhaust device resources.
//
// It is deliberately transport-agnostic (no hypercore / expo imports): the
// caller injects a feed factory and a path-cleanup callback, which keeps this
// pure and unit-testable in plain Node.
//
// This module is the unit-tested SPEC for the identical logic that actually
// runs the on-device knowledge feeds inside the Bare worklet: keep it in sync
// with p2p/remote-feed-manager.mjs (bare-pack can't bundle TS, so the worklet
// carries a plain-ESM copy). The RN side no longer imports this after C2 (the
// worklet owns remote feeds now), but the tests keep the invariants honest.

export interface ClosableFeed {
  close(): Promise<void>;
}

export interface AcquireResult<F> {
  /** The peer's feed — freshly opened when `isNew`, otherwise reused. */
  feed: F;
  /** True only the first time a feed is opened for this peer. */
  isNew: boolean;
}

interface Entry<F extends ClosableFeed> {
  feed: F;
  path: string;
  /** Number of live sockets currently using this feed. */
  refs: number;
}

export class RemoteFeedManager<F extends ClosableFeed> {
  private readonly entries = new Map<string, Entry<F>>();

  constructor(
    private readonly maxFeeds: number,
    /** Remove the on-disk temp dir for an evicted feed. Best-effort. */
    private readonly cleanupPath: (path: string) => void = () => {},
  ) {}

  /** How many distinct peer feeds are currently open. */
  size(): number {
    return this.entries.size;
  }

  /** Whether a feed is already open for this peer. */
  has(peerId: string): boolean {
    return this.entries.has(peerId);
  }

  /**
   * Reuse the peer's feed if one is already open (another live socket / a
   * prior reconnect), incrementing its ref count. Otherwise open a new feed
   * via `factory` — UNLESS the concurrent-feed cap is reached, in which case
   * returns null and the caller must not open a remote feed for this peer.
   */
  acquire(peerId: string, factory: () => { feed: F; path: string }): AcquireResult<F> | null {
    const existing = this.entries.get(peerId);
    if (existing) {
      existing.refs += 1;
      return { feed: existing.feed, isNew: false };
    }
    if (this.entries.size >= this.maxFeeds) return null;
    const { feed, path } = factory();
    this.entries.set(peerId, { feed, path, refs: 1 });
    return { feed, isNew: true };
  }

  /**
   * Drop one socket's ref for a peer. When the last ref goes away the feed is
   * closed and its temp dir removed. No-op for an unknown peer.
   */
  async release(peerId: string): Promise<void> {
    const entry = this.entries.get(peerId);
    if (entry == null) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    this.entries.delete(peerId);
    try {
      await entry.feed.close();
    } finally {
      this.cleanupPath(entry.path);
    }
  }

  /** Close every open feed and clean up its temp dir. Used on dispose. */
  async closeAll(): Promise<void> {
    const all = [...this.entries.values()];
    this.entries.clear();
    for (const entry of all) {
      try {
        await entry.feed.close();
      } catch {
        // Best-effort — keep closing the rest.
      }
      this.cleanupPath(entry.path);
    }
  }
}
