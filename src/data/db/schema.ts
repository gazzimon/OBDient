import { int, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Stores completed diagnostic sessions
export const sessionsTable = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  vehicleId: text('vehicle_id').notNull(),
  startedAt: int('started_at', { mode: 'timestamp' }).notNull(),
  endedAt: int('ended_at', { mode: 'timestamp' }),
  status: text('status', { enum: ['active', 'completed', 'interrupted'] }).notNull(),
  // Full JSON snapshot of ObdParameterSnapshot
  parametersJson: text('parameters_json').notNull().default('{}'),
  // Full JSON array of ChatMessage objects
  messagesJson: text('messages_json').notNull().default('[]'),
  mileage: real('mileage'),
  interpretation: text('interpretation'),
});

// Stores individual DTCs linked to a session
export const troubleCodesTable = sqliteTable('trouble_codes', {
  id: text('id').primaryKey(),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessionsTable.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  system: text('system', { enum: ['P', 'B', 'C', 'U'] }).notNull(),
  description: text('description').notNull(),
  severity: text('severity', { enum: ['critical', 'warning', 'info'] }).notNull(),
  detectedAt: int('detected_at', { mode: 'timestamp' }).notNull(),
  interpretation: text('interpretation'),
});

// Stores known vehicles that have connected before
export const vehiclesTable = sqliteTable('vehicles', {
  id: text('id').primaryKey(),
  make: text('make').notNull().default('Unknown'),
  model: text('model').notNull().default('Unknown'),
  year: int('year'),
  vin: text('vin'),
  manufacturer: text('manufacturer'),
  plantCountry: text('plant_country'),
  protocol: text('protocol').notNull().default('UNKNOWN'),
  adapterAddress: text('adapter_address').notNull(),
  lastConnectedAt: int('last_connected_at', { mode: 'timestamp' }).notNull(),
});

// Stores per-PID readings for a session (for historical charts)
export const pidReadingsTable = sqliteTable('pid_readings', {
  id: int('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  sessionId: text('session_id')
    .notNull()
    .references(() => sessionsTable.id, { onDelete: 'cascade' }),
  pid: text('pid').notNull(),
  value: real('value').notNull(),
  unit: text('unit').notNull(),
  recordedAt: int('recorded_at', { mode: 'timestamp' }).notNull(),
});

// ─── ADR-0009: diagnosis & solutions case base (append-only) ─────────────────

// The structured handoff snapshot sent to the senior (redacted; no VIN)
export const briefsTable = sqliteTable('briefs', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
  // Full DiagnosticBrief JSON
  briefJson: text('brief_json').notNull(),
  // Exact prompt rendered for the senior (reproducibility / audit)
  prompt: text('prompt').notNull(),
});

// Every turn of the case: intake interview + senior conversation
export const conversationTurnsTable = sqliteTable('conversation_turns', {
  id: int('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  role: text('role', { enum: ['user', 'junior', 'senior'] }).notNull(),
  content: text('content').notNull(),
  createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
});

// Case closure — "was it resolved? what was the cause?" (PLAN-002 UX4 / ADR-0004
// Phase 0). One row per session (id = sessionId), upserted from tap-only Reports
// controls. `resolved` is the ground-truth signal that later feeds the
// Beta-Binomial outcome_evidence; `rootCause` is a chip label, never free text.
export const outcomesTable = sqliteTable('outcomes', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  resolved: text('resolved', { enum: ['yes', 'no', 'pending'] }),
  rootCause: text('root_cause'),
  fix: text('fix'),
  confirmed: int('confirmed', { mode: 'boolean' }).notNull().default(false),
  createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
});

// Owner symptom descriptions that matched no taxonomy entry — raw material
// for growing the symptom ontology (ADR-0006-A Phase 4 curation loop)
export const symptomCandidatesTable = sqliteTable('user_symptom_candidates', {
  id: int('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').notNull(),
  description: text('description').notNull(),
  createdAt: int('created_at', { mode: 'timestamp' }).notNull(),
});

export type SymptomCandidateRow = typeof symptomCandidatesTable.$inferSelect;
export type BriefRow = typeof briefsTable.$inferSelect;
export type ConversationTurnRow = typeof conversationTurnsTable.$inferSelect;
export type OutcomeRow = typeof outcomesTable.$inferSelect;

export type SessionRow = typeof sessionsTable.$inferSelect;
export type TroubleCodeRow = typeof troubleCodesTable.$inferSelect;
export type VehicleRow = typeof vehiclesTable.$inferSelect;
export type PidReadingRow = typeof pidReadingsTable.$inferSelect;
