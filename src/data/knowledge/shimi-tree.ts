// SHIMI tree — the in-memory Semantic Hierarchical Memory Index.
//
// Built at boot by joining:
//   - obd-ontology.ts  → concept hierarchy (SKOS)
//   - obd-knowledge.ts → documents assigned to each concept
//
// Confidence weights are persisted in MMKV under key 'shimi-confidence-v1'
// so peer confirmations survive app restarts.
//
// Search strategy (hierarchical, not flat):
//   1. Find the canonical concept for the queried DTC.
//   2. Collect docs from: canonical node + ancestors + SKOS related nodes.
//   3. Sort collected docs by the confidence weight of their owning node.
//   4. Return top-K content strings — ready to inject into the RAG prompt.
//
// This means a high-confirmation node's docs surface above a low-confidence
// node's docs, even if the latter is closer in embedding space.

import { OBD_ONTOLOGY, CONCEPT_MAP, retrievalContext } from './obd-ontology';
import type { SkosConceptNode } from './obd-ontology';
import { OBD_KNOWLEDGE } from './obd-knowledge';
import { createShimiNode, applyConfirmation, applyDecay } from './shimi-node';
import type { ShimiNode } from './shimi-node';
import type { FactChunk, SkosPatch } from './distributed-chunk';
import { QUORUM } from './distributed-chunk';
import { createMMKV } from 'react-native-mmkv';

const PERSISTENCE_KEY = 'shimi-confidence-v1';
const mmkv = createMMKV({ id: 'shimi' });

// ---------------------------------------------------------------------------
// Build the tree
// ---------------------------------------------------------------------------

function buildTree(): Map<string, ShimiNode> {
  const tree = new Map<string, ShimiNode>();

  // Group knowledge docs by conceptId
  const docsByConceptId = new Map<string, typeof OBD_KNOWLEDGE[number][]>();
  for (const doc of OBD_KNOWLEDGE) {
    const list = docsByConceptId.get(doc.conceptId) ?? [];
    list.push(doc);
    docsByConceptId.set(doc.conceptId, list);
  }

  // Create one ShimiNode per SKOS concept
  for (const concept of OBD_ONTOLOGY) {
    const docs = docsByConceptId.get(concept.id) ?? [];
    tree.set(concept.id, createShimiNode(concept, docs));
  }

  return tree;
}

// ---------------------------------------------------------------------------
// Confidence persistence (MMKV)
// ---------------------------------------------------------------------------

interface PersistedWeights {
  [conceptId: string]: { confidence: number; confirmations: number; updatedAt: string };
}

function loadPersistedWeights(): PersistedWeights {
  try {
    const raw = mmkv.getString(PERSISTENCE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistWeights(tree: Map<string, ShimiNode>): void {
  const weights: PersistedWeights = {};
  for (const [id, node] of tree) {
    weights[id] = {
      confidence: node.confidence,
      confirmations: node.confirmations,
      updatedAt: node.updatedAt,
    };
  }
  try {
    mmkv.set(PERSISTENCE_KEY, JSON.stringify(weights));
  } catch {
    // Non-fatal — weights will reset on next boot
  }
}

function applyPersistedWeights(tree: Map<string, ShimiNode>, weights: PersistedWeights): void {
  for (const [id, saved] of Object.entries(weights)) {
    const node = tree.get(id);
    if (!node) continue;
    tree.set(id, {
      ...node,
      confidence: saved.confidence,
      confirmations: saved.confirmations,
      updatedAt: saved.updatedAt,
    });
  }
}

// ---------------------------------------------------------------------------
// ShimiTree class
// ---------------------------------------------------------------------------

export class ShimiTree {
  private tree: Map<string, ShimiNode>;
  private decayTimer: ReturnType<typeof setInterval> | null = null;
  // Pending SKOS patches — keyed by patch id, value is accumulated confirmation count
  private pendingPatches: Map<string, { patch: SkosPatch; votes: number }> = new Map();

  constructor() {
    this.tree = buildTree();
    applyPersistedWeights(this.tree, loadPersistedWeights());
    this.startDecayCycle();
  }

  // ---- Public API --------------------------------------------------------

  /** Retrieve top-K content strings for a DTC id, using hierarchical scoring. */
  search(dtcId: string, topK = 5): string[] {
    const concepts = retrievalContext(dtcId);
    if (concepts.length === 0) return this.fallbackSearch(topK);

    // Collect (content, confidence) pairs from all relevant concepts
    const candidates: { content: string; confidence: number }[] = [];

    for (const concept of concepts) {
      const node = this.tree.get(concept.id);
      if (!node) continue;
      for (const doc of node.docs) {
        candidates.push({ content: doc.content, confidence: node.confidence });
      }
    }

    // Sort by confidence descending, deduplicate, take topK
    return candidates
      .sort((a, b) => b.confidence - a.confidence)
      .map((c) => c.content)
      .filter((content, i, arr) => arr.indexOf(content) === i)
      .slice(0, topK);
  }

  /** Apply a Layer 1 FactChunk confirmation to the matching SHIMI node. */
  applyChunk(chunk: FactChunk): void {
    if (!chunk.dtc) return;

    const contexts = retrievalContext(chunk.dtc);
    if (contexts.length === 0) return;

    const canonicalId = contexts[0]!.id;
    const node = this.tree.get(canonicalId);
    if (!node) return;

    const updated = applyConfirmation(node);
    this.tree.set(canonicalId, updated);
    persistWeights(this.tree);
  }

  /** Apply a Layer 3 SkosPatch. Patches are queued until they reach quorum.
   *  Once quorum is reached the patch is applied to the live tree and persisted. */
  applySkosPatch(patch: SkosPatch): void {
    const entry = this.pendingPatches.get(patch.id) ?? { patch, votes: 0 };
    entry.votes += 1;
    this.pendingPatches.set(patch.id, entry);

    if (entry.votes < QUORUM.skosPatch) return;

    // Quorum reached — apply the patch to the tree
    this._executePatch(patch);
    this.pendingPatches.delete(patch.id);
    persistWeights(this.tree);
  }

  /** Return all pending patches and their current vote counts (for debug UI). */
  pendingPatchStatus(): { patch: SkosPatch; votes: number; quorum: number }[] {
    return [...this.pendingPatches.values()].map((e) => ({
      patch: e.patch,
      votes: e.votes,
      quorum: QUORUM.skosPatch,
    }));
  }

  /** Return the current confidence weight for a concept id. */
  confidenceFor(conceptId: string): number {
    return this.tree.get(conceptId)?.confidence ?? 0;
  }

  /** Return all nodes sorted by confidence — useful for diagnostics/debug UI. */
  topNodes(limit = 10): ShimiNode[] {
    return [...this.tree.values()]
      .filter((n) => n.docs.length > 0)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  dispose(): void {
    if (this.decayTimer !== null) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
  }

  // ---- Private -----------------------------------------------------------

  /** Fallback when no DTC is provided: return docs from highest-confidence nodes. */
  private fallbackSearch(topK: number): string[] {
    const all: { content: string; confidence: number }[] = [];
    for (const node of this.tree.values()) {
      for (const doc of node.docs) {
        all.push({ content: doc.content, confidence: node.confidence });
      }
    }
    return all
      .sort((a, b) => b.confidence - a.confidence)
      .map((c) => c.content)
      .slice(0, topK);
  }

  /** Execute a validated SKOS patch against the live tree. */
  private _executePatch(patch: SkosPatch): void {
    const target = this.tree.get(patch.targetConceptId);
    if (!target) return;

    if (patch.op === 'addNarrower' && patch.newConcept) {
      const { id, label } = patch.newConcept;
      if (this.tree.has(id)) return; // already exists

      const newConceptDef: SkosConceptNode = {
        id,
        label,
        broader: patch.targetConceptId,
        narrower: [],
        related: [],
        dtcs: [],
        conditionIds: [],
      };
      const newNode = createShimiNode(newConceptDef, []);
      this.tree.set(id, newNode);

      // Update parent's narrower list (create a new object — nodes are readonly)
      this.tree.set(patch.targetConceptId, {
        ...target,
        concept: {
          ...target.concept,
          narrower: [...target.concept.narrower, id],
        },
      });
    }

    if (patch.op === 'addRelated' && patch.relatedConceptId) {
      if (this.tree.has(patch.relatedConceptId)) {
        this.tree.set(patch.targetConceptId, {
          ...target,
          concept: {
            ...target.concept,
            related: [...target.concept.related, patch.relatedConceptId],
          },
        });
      }
    }

    if (patch.op === 'addDtcMapping' && patch.dtcId) {
      this.tree.set(patch.targetConceptId, {
        ...target,
        concept: {
          ...target.concept,
          dtcs: [...target.concept.dtcs, patch.dtcId],
        },
      });
    }
  }

  /** Decay all nodes above baseline every 6 hours. */
  private startDecayCycle(): void {
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    this.decayTimer = setInterval(() => {
      let changed = false;
      for (const [id, node] of this.tree) {
        const decayed = applyDecay(node);
        if (decayed.confidence !== node.confidence) {
          this.tree.set(id, decayed);
          changed = true;
        }
      }
      if (changed) persistWeights(this.tree);
    }, SIX_HOURS);
  }
}

// Singleton — one tree for the whole app session.
export const shimiTree = new ShimiTree();
