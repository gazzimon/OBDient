// SHIMI node — a single unit of the Semantic Hierarchical Memory Index.
//
// Each node wraps a SKOS concept from obd-ontology.ts and augments it with:
//   - The knowledge documents that belong to this concept (from obd-knowledge.ts)
//   - A confidence weight that rises as Hypercore peers confirm the node's content
//   - A last-updated timestamp for staleness tracking
//
// The tree is NOT persisted — it is rebuilt in memory at boot from the static
// knowledge base and then updated dynamically by incoming Hypercore chunks.
// Persistence of confidence weights happens via MMKV (see shimi-tree.ts).

import type { SkosConceptNode } from './obd-ontology';
import type { KnowledgeDoc } from './obd-knowledge';

export interface ShimiNode {
  // Mirror of the SKOS concept (id, label, broader, narrower, related)
  readonly concept: SkosConceptNode;
  // All knowledge documents canonically assigned to this concept
  docs: KnowledgeDoc[];
  // 0–1 confidence weight. Starts at 0.5 for static knowledge; rises toward 1
  // as Hypercore peers confirm the same patterns; decays slowly over time.
  confidence: number;
  // ISO 8601 — when this node's confidence was last updated
  updatedAt: string;
  // How many Hypercore confirmations have been received for this node
  confirmations: number;
}

export function createShimiNode(concept: SkosConceptNode, docs: KnowledgeDoc[]): ShimiNode {
  return {
    concept,
    docs,
    confidence: docs.length > 0 ? 0.5 : 0,
    updatedAt: new Date().toISOString(),
    confirmations: 0,
  };
}

// Raise confidence based on a new peer confirmation.
// Uses a dampened update: each confirmation moves confidence halfway toward 1,
// so it asymptotically approaches 1 without ever reaching it cold.
export function applyConfirmation(node: ShimiNode): ShimiNode {
  const next = node.confidence + (1 - node.confidence) * 0.15;
  return {
    ...node,
    confidence: Math.min(next, 0.99),
    confirmations: node.confirmations + 1,
    updatedAt: new Date().toISOString(),
  };
}

// Decay confidence slightly when time passes without new confirmations.
// Called periodically — each decay step reduces confidence by 2%.
export function applyDecay(node: ShimiNode): ShimiNode {
  if (node.confidence <= 0.5) return node; // static floor — never decays below baseline
  return {
    ...node,
    confidence: Math.max(node.confidence * 0.98, 0.5),
    updatedAt: new Date().toISOString(),
  };
}
