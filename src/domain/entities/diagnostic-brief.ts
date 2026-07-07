// The structured handoff from local intake to the senior model (ADR-0009 §2).
// Assembled by deterministic code from confirmed data — never free-written by
// the local LLM. By construction it carries NO VIN and NO user identity.

import type { VehicleState } from './diagnostic-context';
import type { DtcSeverity } from '@/core/utils/dtcParser';

export type IdentitySource = 'vin' | 'user' | 'unknown';

export interface BriefVehicleIdentity {
  readonly make: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly engine: string | null;   // displacement, e.g. "1.6"
  readonly fuelType: string | null; // petrol|diesel|cng|hybrid|electric
  readonly source: IdentitySource;
  // Deliberately NO `vin` field — the data contract is enforced by the type.
}

export interface BriefDtc {
  readonly code: string;
  readonly description: string;
  readonly severity: DtcSeverity;
  readonly faultClassId: string | null;    // canonical SKOS concept (M0)
  readonly faultClassLabel: string | null;
}

export interface BriefReading {
  readonly pid: string;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly alert: string | null; // "critical: ..." when the mapper flagged it
}

export interface BriefSymptom {
  readonly id: string;    // SymptomId from symptom-ontology
  readonly label: string;
}

export interface DiagnosticBrief {
  readonly identity: BriefVehicleIdentity;
  readonly mileageKm: number | null;
  readonly dtcs: readonly BriefDtc[];
  readonly vehicleState: VehicleState;
  readonly liveReadings: readonly BriefReading[];
  readonly symptoms: readonly BriefSymptom[];
  // Owner descriptions that did not match the curated taxonomy — first-class
  // evidence (provenance: user), verbatim but redacted. Nothing is discarded.
  readonly describedSymptoms: readonly string[];
  // Symptoms the owner explicitly denied — negative evidence (ADR-0006-A)
  readonly deniedSymptoms: readonly BriefSymptom[];
  readonly userNotes: string | null; // already redacted (redactText)
  readonly createdAt: number;        // epoch ms, injected by the caller
}

// G0 checklist result — what the intake still has to collect.
export type MissingField = 'make' | 'model' | 'year' | 'obd_evidence';

export interface BriefReadiness {
  readonly ready: boolean;
  readonly missing: readonly MissingField[];
}
