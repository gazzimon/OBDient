// Trust registry — per-peer reputation tracking for the distributed knowledge network.
//
// Each peer is identified by a hash of its Hypercore public key (no raw key stored,
// no PII). The registry tracks:
//   - Total chunks published
//   - Chunks confirmed by other peers (quality signal)
//   - Chunks rejected (below quorum after N days)
//   - A resulting reputation score (0–1)
//
// The score gates how much weight a peer's chunks receive when merging into the
// RAG context. A brand-new peer starts at 0.3 (neutral) and moves toward 1 as
// its contributions accumulate confirmed value, or toward 0 if they don't.
//
// Reputation is persisted in MMKV under 'trust-registry-v1' so it survives restarts.
//
// Score update formula (Bayesian-inspired, dampened):
//   new_score = old_score + α * (outcome - old_score)
//   α = 0.1 (learning rate — slow to move, hard to game)
//   outcome = 1.0 for confirmed, 0.0 for expired without quorum

import { createMMKV } from 'react-native-mmkv';

const PERSISTENCE_KEY = 'trust-registry-v1';
const LEARNING_RATE   = 0.1;
const INITIAL_SCORE   = 0.3;
// Minimum score to have any chunks used in RAG (below this → peer is silenced)
export const MIN_TRUST_SCORE = 0.15;
// Peers above this score have their Layer 2 patterns fully considered
export const HIGH_TRUST_SCORE = 0.7;

const mmkv = createMMKV({ id: 'trust' });

export interface PeerRecord {
  peerId: string;       // sha256 hex of the peer's feed public key
  score: number;        // 0–1 reputation score
  published: number;    // total chunks published by this peer
  confirmed: number;    // chunks that reached quorum
  rejected: number;     // chunks that expired without reaching quorum
  firstSeen: string;    // ISO 8601
  lastSeen: string;     // ISO 8601
}

type Registry = Record<string, PeerRecord>;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function load(): Registry {
  try {
    const raw = mmkv.getString(PERSISTENCE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(registry: Registry): void {
  try {
    mmkv.set(PERSISTENCE_KEY, JSON.stringify(registry));
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------------------------------
// TrustRegistry class
// ---------------------------------------------------------------------------

export class TrustRegistry {
  private registry: Registry;

  constructor() {
    this.registry = load();
  }

  // ---- Public API --------------------------------------------------------

  /** Returns the trust score for a peer (0–1). Unknown peers get INITIAL_SCORE. */
  scoreFor(peerId: string): number {
    return this.registry[peerId]?.score ?? INITIAL_SCORE;
  }

  /** Returns true if this peer's chunks should be used in RAG context. */
  isTrusted(peerId: string): boolean {
    return this.scoreFor(peerId) >= MIN_TRUST_SCORE;
  }

  /** Register a new chunk publication from a peer. */
  recordPublication(peerId: string): void {
    const rec = this._getOrCreate(peerId);
    rec.published += 1;
    rec.lastSeen = new Date().toISOString();
    this.registry[peerId] = rec;
    save(this.registry);
  }

  /** A chunk from this peer reached quorum — positive signal. */
  recordConfirmation(peerId: string): void {
    const rec = this._getOrCreate(peerId);
    rec.confirmed += 1;
    rec.score = rec.score + LEARNING_RATE * (1.0 - rec.score);
    rec.lastSeen = new Date().toISOString();
    this.registry[peerId] = rec;
    save(this.registry);
  }

  /** A chunk from this peer expired without reaching quorum — negative signal. */
  recordRejection(peerId: string): void {
    const rec = this._getOrCreate(peerId);
    rec.rejected += 1;
    rec.score = rec.score + LEARNING_RATE * (0.0 - rec.score);
    rec.lastSeen = new Date().toISOString();
    this.registry[peerId] = rec;
    save(this.registry);
  }

  /**
   * Weight a chunk's confidence by the publisher's trust score.
   * High-trust peers get full confidence; low-trust peers get discounted.
   *   effective_confidence = chunk_confidence * lerp(0.5, 1.0, peer_score)
   */
  weightedConfidence(baseConfidence: number, peerId: string): number {
    const score = this.scoreFor(peerId);
    const multiplier = 0.5 + 0.5 * score; // range [0.5, 1.0]
    return Math.min(baseConfidence * multiplier, 0.99);
  }

  /** Return all peer records sorted by score descending (for Settings UI). */
  allPeers(): PeerRecord[] {
    return Object.values(this.registry).sort((a, b) => b.score - a.score);
  }

  /** Return summary stats for the Settings panel badge. */
  stats(): { total: number; trusted: number; silenced: number } {
    const peers = Object.values(this.registry);
    return {
      total:    peers.length,
      trusted:  peers.filter((p) => p.score >= MIN_TRUST_SCORE).length,
      silenced: peers.filter((p) => p.score < MIN_TRUST_SCORE).length,
    };
  }

  // ---- Private -----------------------------------------------------------

  private _getOrCreate(peerId: string): PeerRecord {
    if (this.registry[peerId]) return this.registry[peerId];
    const now = new Date().toISOString();
    return {
      peerId,
      score: INITIAL_SCORE,
      published: 0,
      confirmed: 0,
      rejected: 0,
      firstSeen: now,
      lastSeen: now,
    };
  }
}

// Singleton.
export const trustRegistry = new TrustRegistry();
