// Remote feed lifecycle manager — Bare-worklet runtime copy of
// src/data/datasources/remote-feed-manager.ts (ADR-0010 P0). Plain ESM so
// bare-pack can bundle it into the worklet; the .ts version stays the unit-
// tested spec (src/__tests__/remote-feed-manager.test.ts). Keep the two in sync.
//
// Three invariants under peer churn (the seed reconnects constantly):
//   1. ONE feed per peerId, reused across reconnects (ref-counted per socket).
//   2. The feed is closed and its temp dir removed when the LAST socket drops.
//   3. A hard cap on concurrently-open feeds — beyond it, new peers get local
//      replication only, so a flood of peers can't exhaust device resources.
//
// Transport-agnostic by design: the caller injects a feed factory and a
// path-cleanup callback (no hypercore / bare-fs imports here).

export class RemoteFeedManager {
  constructor(maxFeeds, cleanupPath = () => {}) {
    this.maxFeeds = maxFeeds;
    this.cleanupPath = cleanupPath;
    /** @type {Map<string, { feed: any, path: string, refs: number }>} */
    this.entries = new Map();
  }

  /** How many distinct peer feeds are currently open. */
  size() {
    return this.entries.size;
  }

  /** Whether a feed is already open for this peer. */
  has(peerId) {
    return this.entries.has(peerId);
  }

  /**
   * Reuse the peer's feed if one is already open (another live socket / a prior
   * reconnect), incrementing its ref count. Otherwise open a new feed via
   * `factory` — UNLESS the concurrent-feed cap is reached, in which case returns
   * null and the caller must not open a remote feed for this peer.
   *
   * @param {string} peerId
   * @param {() => { feed: any, path: string }} factory
   * @returns {{ feed: any, isNew: boolean } | null}
   */
  acquire(peerId, factory) {
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
  async release(peerId) {
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
  async closeAll() {
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
