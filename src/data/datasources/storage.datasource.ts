// SQLite storage datasource using Drizzle ORM + expo-sqlite.
// Opens a single database connection shared across the app.
// All write operations are serialized through a promise queue to prevent
// concurrent mutations on the single SQLite connection.

import * as ExpoSQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { desc, eq } from 'drizzle-orm';
import {
  sessionsTable,
  troubleCodesTable,
  vehiclesTable,
  pidReadingsTable,
  briefsTable,
  conversationTurnsTable,
  outcomesTable,
  type SessionRow,
  type TroubleCodeRow,
  type ConversationTurnRow,
} from '@/data/db/schema';
import { DatabaseError } from '@/core/errors/obd.errors';

const DB_NAME = 'obdient.db';

function openDatabase() {
  const sqlite = ExpoSQLite.openDatabaseSync(DB_NAME);
  return drizzle(sqlite);
}

let _db: ReturnType<typeof openDatabase> | null = null;

function getDb() {
  if (!_db) _db = openDatabase();
  return _db;
}

// ─── Write serialization queue ────────────────────────────────────────────────
// SQLite allows one writer at a time. This queue ensures mutations never race,
// even when callers don't await properly.

let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(label: string, fn: () => T): Promise<T> {
  const next = writeQueue.then(() => {
    try {
      return fn();
    } catch (err) {
      throw new DatabaseError(`Failed to ${label}`, err);
    }
  });
  // Always reset to resolved so future writes aren't blocked by a failed write
  writeQueue = next.catch(() => undefined);
  return next;
}

// ─── Database initialization ──────────────────────────────────────────────────

export async function initializeDatabase(): Promise<void> {
  return enqueueWrite('initialize database', () => {
    const db = getDb();
    db.run(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id TEXT PRIMARY KEY,
        make TEXT NOT NULL DEFAULT 'Unknown',
        model TEXT NOT NULL DEFAULT 'Unknown',
        year INTEGER,
        vin TEXT,
        manufacturer TEXT,
        plant_country TEXT,
        protocol TEXT NOT NULL DEFAULT 'UNKNOWN',
        adapter_address TEXT NOT NULL,
        last_connected_at INTEGER NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        vehicle_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL,
        parameters_json TEXT NOT NULL DEFAULT '{}',
        interpretation TEXT,
        FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS trouble_codes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        code TEXT NOT NULL,
        system TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT NOT NULL,
        detected_at INTEGER NOT NULL,
        interpretation TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS pid_readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        pid TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT NOT NULL,
        recorded_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );
    `);
    // ADR-0009 case base (append-only): briefs, conversation turns, outcomes
    db.run(`
      CREATE TABLE IF NOT EXISTS briefs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        brief_json TEXT NOT NULL,
        prompt TEXT NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS conversation_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS outcomes (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        root_cause TEXT,
        fix TEXT,
        confirmed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `);
    // Migrations: ALTER TABLE is a no-op if the column already exists on SQLite
    // so we catch the error silently — idempotent on fresh installs too.
    for (const sql of [
      `ALTER TABLE vehicles ADD COLUMN manufacturer TEXT`,
      `ALTER TABLE vehicles ADD COLUMN plant_country TEXT`,
      `ALTER TABLE sessions ADD COLUMN messages_json TEXT NOT NULL DEFAULT '[]'`,
      `ALTER TABLE sessions ADD COLUMN mileage REAL`,
    ]) {
      try { db.run(sql); } catch { /* column already exists */ }
    }
  });
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export function insertSession(row: typeof sessionsTable.$inferInsert): Promise<void> {
  return enqueueWrite('insert session', () => {
    getDb()
      .insert(sessionsTable)
      .values(row)
      .onConflictDoUpdate({ target: sessionsTable.id, set: row })
      .run();
  });
}

export function updateSession(
  id: string,
  patch: Partial<typeof sessionsTable.$inferInsert>,
): Promise<void> {
  return enqueueWrite('update session', () => {
    getDb().update(sessionsTable).set(patch).where(eq(sessionsTable.id, id)).run();
  });
}

// Reads are concurrent — no queue needed (SQLite allows parallel reads)
export async function getSessionById(id: string): Promise<SessionRow | null> {
  try {
    const rows = getDb().select().from(sessionsTable).where(eq(sessionsTable.id, id)).all();
    return rows[0] ?? null;
  } catch (err) {
    throw new DatabaseError('Failed to fetch session', err);
  }
}

export async function listSessions(limit = 50): Promise<SessionRow[]> {
  try {
    return getDb()
      .select()
      .from(sessionsTable)
      .orderBy(desc(sessionsTable.startedAt))
      .limit(limit)
      .all();
  } catch (err) {
    throw new DatabaseError('Failed to list sessions', err);
  }
}

export function deleteSession(id: string): Promise<void> {
  return enqueueWrite('delete session', () => {
    getDb().delete(sessionsTable).where(eq(sessionsTable.id, id)).run();
  });
}

// ─── Trouble codes ────────────────────────────────────────────────────────────

export function insertTroubleCode(
  row: typeof troubleCodesTable.$inferInsert,
): Promise<void> {
  return enqueueWrite('insert trouble code', () => {
    getDb().insert(troubleCodesTable).values(row).run();
  });
}

export async function getTroubleCodesBySession(sessionId: string): Promise<TroubleCodeRow[]> {
  try {
    return getDb()
      .select()
      .from(troubleCodesTable)
      .where(eq(troubleCodesTable.sessionId, sessionId))
      .all();
  } catch (err) {
    throw new DatabaseError('Failed to fetch trouble codes', err);
  }
}

// ─── Vehicles ─────────────────────────────────────────────────────────────────

export function upsertVehicle(row: typeof vehiclesTable.$inferInsert): Promise<void> {
  return enqueueWrite('upsert vehicle', () => {
    getDb()
      .insert(vehiclesTable)
      .values(row)
      .onConflictDoUpdate({ target: vehiclesTable.id, set: row })
      .run();
  });
}

// Returns the most recently connected vehicle matching this VIN, or null.
// Used to avoid consuming Vincario API credits on reconnection.
export async function getVehicleByVin(vin: string): Promise<typeof vehiclesTable.$inferSelect | null> {
  try {
    const rows = getDb()
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.vin, vin))
      .orderBy(desc(vehiclesTable.lastConnectedAt))
      .limit(1)
      .all();
    return rows[0] ?? null;
  } catch (err) {
    throw new DatabaseError('Failed to fetch vehicle by VIN', err);
  }
}

// ─── ADR-0009 case base (append-only) ────────────────────────────────────────

export function insertBrief(row: typeof briefsTable.$inferInsert): Promise<void> {
  return enqueueWrite('insert brief', () => {
    getDb().insert(briefsTable).values(row).run();
  });
}

export function insertConversationTurn(
  row: typeof conversationTurnsTable.$inferInsert,
): Promise<void> {
  return enqueueWrite('insert conversation turn', () => {
    getDb().insert(conversationTurnsTable).values(row).run();
  });
}

export function insertOutcome(row: typeof outcomesTable.$inferInsert): Promise<void> {
  return enqueueWrite('insert outcome', () => {
    getDb().insert(outcomesTable).values(row).run();
  });
}

export async function getTurnsBySession(sessionId: string): Promise<ConversationTurnRow[]> {
  try {
    return getDb()
      .select()
      .from(conversationTurnsTable)
      .where(eq(conversationTurnsTable.sessionId, sessionId))
      .all();
  } catch (err) {
    throw new DatabaseError('Failed to fetch conversation turns', err);
  }
}

// ─── PID readings ─────────────────────────────────────────────────────────────

export function insertPidReading(
  row: typeof pidReadingsTable.$inferInsert,
): Promise<void> {
  return enqueueWrite('insert PID reading', () => {
    getDb().insert(pidReadingsTable).values(row).run();
  });
}
