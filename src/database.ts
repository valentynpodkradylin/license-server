import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type SqliteDatabase = Database.Database;

export function openDatabase(filename: string): SqliteDatabase {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS licenses (
      key TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      expires_at TEXT,
      blocked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS activations (
      license_key TEXT NOT NULL,
      device_id TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      PRIMARY KEY (license_key, device_id),
      FOREIGN KEY (license_key) REFERENCES licenses(key)
    );

    CREATE TABLE IF NOT EXISTS updates (
      version TEXT PRIMARY KEY,
      notes TEXT NOT NULL,
      link TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation TEXT NOT NULL,
      license_key TEXT,
      device_id TEXT,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}
