import { RemoteFeedManager } from '@/data/datasources/remote-feed-manager';

// Minimal stateful fake feed — records whether it was closed.
class FakeFeed {
  closed = false;
  async close(): Promise<void> {
    this.closed = true;
  }
}

function make(maxFeeds: number) {
  const cleaned: string[] = [];
  const created: string[] = [];
  const manager = new RemoteFeedManager<FakeFeed>(maxFeeds, (p) => cleaned.push(p));
  const factory = (peerId: string) => () => {
    created.push(peerId);
    return { feed: new FakeFeed(), path: `/tmp/${peerId}` };
  };
  return { manager, factory, cleaned, created };
}

describe('RemoteFeedManager', () => {
  it('opens one feed per new peer', () => {
    const { manager, factory, created } = make(8);
    const a = manager.acquire('peerA', factory('peerA'));
    expect(a).not.toBeNull();
    expect(a!.isNew).toBe(true);
    expect(manager.size()).toBe(1);
    expect(created).toEqual(['peerA']);
  });

  it('reuses the feed on reconnect instead of leaking a new one', () => {
    const { manager, factory, created } = make(8);
    const first = manager.acquire('peerA', factory('peerA'));
    const second = manager.acquire('peerA', factory('peerA'));
    expect(second!.isNew).toBe(false);
    expect(second!.feed).toBe(first!.feed); // same underlying feed
    expect(manager.size()).toBe(1); // no leak
    expect(created).toEqual(['peerA']); // factory ran exactly once
  });

  it('closes and cleans up only when the last socket releases', async () => {
    const { manager, factory, cleaned } = make(8);
    const acquired = manager.acquire('peerA', factory('peerA'))!;
    manager.acquire('peerA', factory('peerA')); // second live socket → refs = 2

    await manager.release('peerA'); // refs 2 → 1: still open
    expect(manager.size()).toBe(1);
    expect(acquired.feed.closed).toBe(false);

    await manager.release('peerA'); // refs 1 → 0: close + cleanup
    expect(manager.size()).toBe(0);
    expect(acquired.feed.closed).toBe(true);
    expect(cleaned).toEqual(['/tmp/peerA']);
  });

  it('re-opens a fresh feed after a peer fully disconnects and returns', async () => {
    const { manager, factory, created } = make(8);
    manager.acquire('peerA', factory('peerA'));
    await manager.release('peerA');
    const again = manager.acquire('peerA', factory('peerA'));
    expect(again!.isNew).toBe(true);
    expect(created).toEqual(['peerA', 'peerA']);
  });

  it('caps concurrent feeds, returning null for peers over the limit', () => {
    const { manager, factory, created } = make(2);
    expect(manager.acquire('p1', factory('p1'))).not.toBeNull();
    expect(manager.acquire('p2', factory('p2'))).not.toBeNull();
    const overflow = manager.acquire('p3', factory('p3'));
    expect(overflow).toBeNull(); // cap hit
    expect(manager.size()).toBe(2);
    expect(created).toEqual(['p1', 'p2']); // p3's factory never ran
  });

  it('a capped-out peer becomes admissible once a slot frees up', async () => {
    const { manager, factory } = make(1);
    manager.acquire('p1', factory('p1'));
    expect(manager.acquire('p2', factory('p2'))).toBeNull();
    await manager.release('p1');
    expect(manager.acquire('p2', factory('p2'))).not.toBeNull();
  });

  it('release is a no-op for an unknown peer', async () => {
    const { manager } = make(4);
    await expect(manager.release('ghost')).resolves.toBeUndefined();
  });

  it('closeAll closes every feed and clears the registry', async () => {
    const { manager, factory, cleaned } = make(8);
    const a = manager.acquire('p1', factory('p1'))!;
    const b = manager.acquire('p2', factory('p2'))!;
    await manager.closeAll();
    expect(manager.size()).toBe(0);
    expect(a.feed.closed).toBe(true);
    expect(b.feed.closed).toBe(true);
    expect(cleaned.sort()).toEqual(['/tmp/p1', '/tmp/p2']);
  });
});
