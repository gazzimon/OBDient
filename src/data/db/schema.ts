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

export type SessionRow = typeof sessionsTable.$inferSelect;
export type TroubleCodeRow = typeof troubleCodesTable.$inferSelect;
export type VehicleRow = typeof vehiclesTable.$inferSelect;
export type PidReadingRow = typeof pidReadingsTable.$inferSelect;
