// SQLite storage datasource using Drizzle ORM + expo-sqlite.
// Opens a single database connection shared across the app.

import * as ExpoSQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { desc, eq } from 'drizzle-orm';
import {
  sessionsTable,
  troubleCodesTable,
  vehiclesTable,
  pidReadingsTable,
  type SessionRow,
  type TroubleCodeRow,
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

// Runs all CREATE TABLE IF NOT EXISTS statements
export async function initializeDatabase(): Promise<void> {
  const db = getDb();
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id TEXT PRIMARY KEY,
        make TEXT NOT NULL DEFAULT 'Unknown',
        model TEXT NOT NULL DEFAULT 'Unknown',
        year INTEGER,
        vin TEXT,
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
  } catch (err) {
    throw new DatabaseError('Failed to initialize database', err);
  }
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export async function insertSession(row: typeof sessionsTable.$inferInsert): Promise<void> {
  try {
    getDb().insert(sessionsTable).values(row).run();
  } catch (err) {
    throw new DatabaseError('Failed to insert session', err);
  }
}

export async function updateSession(
  id: string,
  patch: Partial<typeof sessionsTable.$inferInsert>,
): Promise<void> {
  try {
    getDb().update(sessionsTable).set(patch).where(eq(sessionsTable.id, id)).run();
  } catch (err) {
    throw new DatabaseError('Failed to update session', err);
  }
}

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

export async function deleteSession(id: string): Promise<void> {
  try {
    getDb().delete(sessionsTable).where(eq(sessionsTable.id, id)).run();
  } catch (err) {
    throw new DatabaseError('Failed to delete session', err);
  }
}

// ─── Trouble codes ────────────────────────────────────────────────────────────

export async function insertTroubleCode(
  row: typeof troubleCodesTable.$inferInsert,
): Promise<void> {
  try {
    getDb().insert(troubleCodesTable).values(row).run();
  } catch (err) {
    throw new DatabaseError('Failed to insert trouble code', err);
  }
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

export async function upsertVehicle(row: typeof vehiclesTable.$inferInsert): Promise<void> {
  try {
    getDb()
      .insert(vehiclesTable)
      .values(row)
      .onConflictDoUpdate({ target: vehiclesTable.id, set: row })
      .run();
  } catch (err) {
    throw new DatabaseError('Failed to upsert vehicle', err);
  }
}

// ─── PID readings ─────────────────────────────────────────────────────────────

export async function insertPidReading(
  row: typeof pidReadingsTable.$inferInsert,
): Promise<void> {
  try {
    getDb().insert(pidReadingsTable).values(row).run();
  } catch (err) {
    throw new DatabaseError('Failed to insert PID reading', err);
  }
}
